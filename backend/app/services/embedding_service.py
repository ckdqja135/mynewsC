from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
from typing import List, Tuple
from app.models import NewsArticle
import logging

logger = logging.getLogger(__name__)


class EmbeddingService:
    """
    Service for generating embeddings and calculating semantic similarity.
    Uses Korean-optimized Sentence Transformer model.
    """

    def __init__(self, model_name: str = "jhgan/ko-sroberta-multitask"):
        """
        Initialize the embedding service with a Korean language model.

        Args:
            model_name: Name of the Sentence Transformer model to use.
                       Default is jhgan/ko-sroberta-multitask (Korean-optimized)
        """
        try:
            logger.info(f"Loading embedding model: {model_name}")
            self.model = SentenceTransformer(model_name)
            logger.info("Embedding model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load embedding model: {str(e)}")
            raise RuntimeError(f"Failed to initialize embedding service: {str(e)}")

    def encode_text(self, text: str) -> np.ndarray:
        """
        Convert text to embedding vector.

        Args:
            text: Input text to encode

        Returns:
            Numpy array representing the embedding vector
        """
        if not text or text.strip() == "":
            # Return zero vector for empty text
            return np.zeros(self.model.get_sentence_embedding_dimension())

        try:
            embedding = self.model.encode(text, convert_to_numpy=True)
            return embedding
        except Exception as e:
            logger.error(f"Failed to encode text: {str(e)}")
            return np.zeros(self.model.get_sentence_embedding_dimension())

    def encode_batch(self, texts: List[str]) -> np.ndarray:
        """
        Convert multiple texts to embedding vectors (batch processing).
        More efficient than encoding one by one.

        Args:
            texts: List of texts to encode

        Returns:
            2D numpy array where each row is an embedding vector
        """
        if not texts:
            return np.array([])

        try:
            embeddings = self.model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
            return embeddings
        except Exception as e:
            logger.error(f"Failed to encode batch: {str(e)}")
            # Return zero vectors as fallback
            dim = self.model.get_sentence_embedding_dimension()
            return np.zeros((len(texts), dim))

    def calculate_similarity(self, query_embedding: np.ndarray, article_embeddings: np.ndarray) -> np.ndarray:
        """
        Calculate cosine similarity between query and article embeddings.

        Args:
            query_embedding: 1D array representing the query embedding
            article_embeddings: 2D array where each row is an article embedding

        Returns:
            1D array of similarity scores (0 to 1)
        """
        try:
            # Reshape query embedding to 2D array (1, dim)
            query_2d = query_embedding.reshape(1, -1)

            # Calculate cosine similarity
            similarities = cosine_similarity(query_2d, article_embeddings)[0]

            return similarities
        except Exception as e:
            logger.error(f"Failed to calculate similarity: {str(e)}")
            # Return zeros if calculation fails
            return np.zeros(len(article_embeddings))

    def rank_articles_by_similarity(
        self,
        query: str,
        articles: List[NewsArticle],
        min_similarity: float = 0.0,
        chunk_size: int = 100,
        max_results: int = None,
        early_stop_threshold: int = None
    ) -> List[Tuple[NewsArticle, float]]:
        """
        Rank articles by semantic similarity to the query with optimized chunked processing.

        Args:
            query: Search query
            articles: List of news articles to rank
            min_similarity: Minimum similarity threshold (0 to 1)
            chunk_size: Number of articles to process in each chunk (default: 100)
            max_results: Maximum number of results to return (None = unlimited)
            early_stop_threshold: Stop processing if we have this many good results (None = process all)

        Returns:
            List of tuples (article, similarity_score) sorted by similarity (highest first)
            Only includes articles with similarity >= min_similarity
        """
        if not articles:
            return []

        try:
            # Encode query once
            logger.info(f"Encoding query: {query}")
            query_embedding = self.encode_text(query)

            # Process in chunks
            all_results = []
            total_articles = len(articles)

            logger.info(f"Processing {total_articles} articles in chunks of {chunk_size}")

            for chunk_start in range(0, total_articles, chunk_size):
                chunk_end = min(chunk_start + chunk_size, total_articles)
                chunk_articles = articles[chunk_start:chunk_end]

                logger.info(f"Processing chunk {chunk_start//chunk_size + 1}: articles {chunk_start+1}-{chunk_end}")

                # Prepare article texts (title + snippet)
                article_texts = []
                for article in chunk_articles:
                    text = article.title
                    if article.snippet:
                        text += " " + article.snippet
                    article_texts.append(text)

                # Encode chunk articles in batch
                article_embeddings = self.encode_batch(article_texts)

                # Calculate similarities for this chunk
                similarities = self.calculate_similarity(query_embedding, article_embeddings)

                # Collect results from this chunk that meet threshold
                for article, score in zip(chunk_articles, similarities):
                    if score >= min_similarity:
                        all_results.append((article, float(score)))

                logger.info(f"Chunk {chunk_start//chunk_size + 1}: found {sum(1 for s in similarities if s >= min_similarity)} articles above threshold")

                # Early stopping: if we have enough good results, stop processing
                if early_stop_threshold and len(all_results) >= early_stop_threshold:
                    logger.info(f"Early stop: collected {len(all_results)} results (threshold: {early_stop_threshold})")
                    break

            # Sort all results by similarity (highest first)
            all_results.sort(key=lambda x: x[1], reverse=True)

            # Apply max_results limit if specified
            if max_results:
                all_results = all_results[:max_results]

            logger.info(f"Final results: {len(all_results)} articles")
            return all_results

        except Exception as e:
            logger.error(f"Failed to rank articles: {str(e)}")
            # Return empty list if ranking fails
            return []


# Singleton instance
_embedding_service_instance = None


def get_embedding_service() -> EmbeddingService:
    """
    Get or create singleton instance of EmbeddingService.
    This ensures the model is loaded only once.
    """
    global _embedding_service_instance

    if _embedding_service_instance is None:
        _embedding_service_instance = EmbeddingService()

    return _embedding_service_instance
