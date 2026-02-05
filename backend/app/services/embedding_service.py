from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
from typing import List, Tuple, Dict
from app.models import NewsArticle
import logging
import faiss
import pickle
import os
from pathlib import Path

# Set HuggingFace timeout to 300 seconds (5 minutes)
os.environ['HF_HUB_DOWNLOAD_TIMEOUT'] = '300'

logger = logging.getLogger(__name__)


class EmbeddingService:
    """
    Service for generating embeddings and calculating semantic similarity.
    Uses Korean-optimized Sentence Transformer model with FAISS vector search.
    """

    def __init__(self, model_name: str = "jhgan/ko-sroberta-multitask", cache_dir: str = "data/embeddings"):
        """
        Initialize the embedding service with a Korean language model and FAISS index.

        Args:
            model_name: Name of the Sentence Transformer model to use.
                       Default is jhgan/ko-sroberta-multitask (Korean-optimized)
            cache_dir: Directory to store FAISS index and metadata
        """
        try:
            logger.info(f"Loading embedding model: {model_name}")
            self.model = SentenceTransformer(model_name)
            self.embedding_dim = self.model.get_sentence_embedding_dimension()
            logger.info(f"Embedding model loaded successfully (dimension: {self.embedding_dim})")

            # FAISS index setup
            self.cache_dir = Path(cache_dir)
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            self.index_path = self.cache_dir / "faiss_index.bin"
            self.metadata_path = self.cache_dir / "metadata.pkl"

            # Article ID to index mapping
            self.article_id_to_idx: Dict[str, int] = {}
            self.idx_to_article_id: Dict[int, str] = {}
            self.article_texts: Dict[str, str] = {}  # Store article texts for debugging

            # Initialize or load FAISS index
            self._initialize_faiss_index()

            logger.info(f"FAISS index initialized with {self.index.ntotal} vectors")

        except Exception as e:
            logger.error(f"Failed to load embedding model: {str(e)}")
            raise RuntimeError(f"Failed to initialize embedding service: {str(e)}")

    def _initialize_faiss_index(self):
        """
        Initialize FAISS index. Load from disk if exists, otherwise create new.
        """
        if self.index_path.exists() and self.metadata_path.exists():
            try:
                logger.info("Loading existing FAISS index from disk...")
                self.index = faiss.read_index(str(self.index_path))

                with open(self.metadata_path, 'rb') as f:
                    metadata = pickle.load(f)
                    self.article_id_to_idx = metadata.get('article_id_to_idx', {})
                    self.idx_to_article_id = metadata.get('idx_to_article_id', {})
                    self.article_texts = metadata.get('article_texts', {})

                logger.info(f"Loaded FAISS index with {self.index.ntotal} vectors")
                return
            except Exception as e:
                logger.warning(f"Failed to load existing index: {str(e)}. Creating new index.")

        # Create new FAISS index (Inner Product for cosine similarity with normalized vectors)
        self.index = faiss.IndexFlatIP(self.embedding_dim)
        logger.info("Created new FAISS index")

    def _save_index(self):
        """
        Save FAISS index and metadata to disk.
        """
        try:
            faiss.write_index(self.index, str(self.index_path))

            metadata = {
                'article_id_to_idx': self.article_id_to_idx,
                'idx_to_article_id': self.idx_to_article_id,
                'article_texts': self.article_texts
            }

            with open(self.metadata_path, 'wb') as f:
                pickle.dump(metadata, f)

            logger.info(f"Saved FAISS index with {self.index.ntotal} vectors to disk")
        except Exception as e:
            logger.error(f"Failed to save FAISS index: {str(e)}")

    def add_articles_to_index(self, articles: List[NewsArticle]):
        """
        Add new articles to FAISS index (only if not already indexed).

        Args:
            articles: List of news articles to add
        """
        new_articles = []
        new_texts = []

        for article in articles:
            if article.id not in self.article_id_to_idx:
                new_articles.append(article)
                text = article.title
                if article.snippet:
                    text += " " + article.snippet
                new_texts.append(text)

        if not new_articles:
            logger.info("No new articles to add to index")
            return

        logger.info(f"Adding {len(new_articles)} new articles to FAISS index...")

        # Generate embeddings for new articles
        embeddings = self.encode_batch(new_texts)

        # Normalize embeddings for cosine similarity (FAISS Inner Product)
        faiss.normalize_L2(embeddings)

        # Add to FAISS index
        start_idx = self.index.ntotal
        self.index.add(embeddings)

        # Update metadata
        for i, article in enumerate(new_articles):
            idx = start_idx + i
            self.article_id_to_idx[article.id] = idx
            self.idx_to_article_id[idx] = article.id
            self.article_texts[article.id] = new_texts[i]

        # Save to disk
        self._save_index()

        logger.info(f"Added {len(new_articles)} articles. Total in index: {self.index.ntotal}")

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

    def rank_articles_by_similarity_faiss(
        self,
        query: str,
        articles: List[NewsArticle],
        min_similarity: float = 0.0,
        max_results: int = None
    ) -> List[Tuple[NewsArticle, float]]:
        """
        Rank articles by semantic similarity using FAISS for ultra-fast search.

        This method:
        1. Adds new articles to FAISS index (cached articles are skipped)
        2. Uses FAISS to find top-k most similar articles
        3. Filters by minimum similarity threshold
        4. Returns sorted results

        Args:
            query: Search query
            articles: List of news articles to rank
            min_similarity: Minimum similarity threshold (0 to 1)
            max_results: Maximum number of results to return (None = unlimited)

        Returns:
            List of tuples (article, similarity_score) sorted by similarity (highest first)
        """
        if not articles:
            return []

        try:
            # Add new articles to FAISS index
            self.add_articles_to_index(articles)

            # Encode query
            logger.info(f"Encoding query: {query}")
            query_embedding = self.encode_text(query)

            # Normalize query embedding for cosine similarity
            query_embedding_norm = query_embedding.reshape(1, -1).copy()
            faiss.normalize_L2(query_embedding_norm)

            # Search FAISS index
            # Search for more than needed to account for filtering
            k = min(self.index.ntotal, max_results * 3 if max_results else self.index.ntotal)
            k = max(k, 100)  # At least search top 100

            logger.info(f"Searching FAISS index ({self.index.ntotal} vectors) for top-{k} results...")
            distances, indices = self.index.search(query_embedding_norm, k)

            # Convert FAISS results to article matches
            results = []
            article_id_set = {article.id for article in articles}

            for idx, similarity in zip(indices[0], distances[0]):
                if idx == -1:  # FAISS returns -1 for empty slots
                    continue

                article_id = self.idx_to_article_id.get(idx)
                if article_id and article_id in article_id_set and similarity >= min_similarity:
                    # Find the article object
                    article = next((a for a in articles if a.id == article_id), None)
                    if article:
                        results.append((article, float(similarity)))

                # Early stop if we have enough results
                if max_results and len(results) >= max_results:
                    break

            logger.info(f"FAISS search complete: {len(results)} articles above threshold")
            return results

        except Exception as e:
            logger.error(f"Failed to rank articles with FAISS: {str(e)}")
            # Fallback to original method
            logger.warning("Falling back to non-FAISS method")
            return self.rank_articles_by_similarity(
                query=query,
                articles=articles,
                min_similarity=min_similarity,
                max_results=max_results
            )


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
