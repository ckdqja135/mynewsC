import hashlib


def generate_news_id(url: str, title: str) -> str:
    """
    Generate unique ID from url and title using sha256.
    Returns first 24 characters of hash.
    """
    content = f"{url}|{title}"
    hash_object = hashlib.sha256(content.encode('utf-8'))
    return hash_object.hexdigest()[:24]
