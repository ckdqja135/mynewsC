from datetime import datetime, timedelta
from dateutil import parser
from typing import Optional
import re


def parse_naver_date(date_str: str) -> Optional[datetime]:
    """Parse Naver pubDate in RFC2822 format. Returns timezone-aware datetime."""
    try:
        from datetime import timezone
        dt = parser.parse(date_str)
        # Make sure it's timezone-aware
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def parse_google_relative_time(time_str: str) -> Optional[datetime]:
    """
    Parse Google relative time strings like '2 hours ago', '1 day ago', '2시간 전', '3일 전'.
    Returns timezone-aware datetime in UTC.
    """
    try:
        from datetime import timezone
        time_str = time_str.lower().strip()
        now = datetime.now(timezone.utc)

        # Match patterns - English and Korean
        patterns = [
            # English patterns
            (r'(\d+)\s*second[s]?\s*ago', 'seconds'),
            (r'(\d+)\s*minute[s]?\s*ago', 'minutes'),
            (r'(\d+)\s*hour[s]?\s*ago', 'hours'),
            (r'(\d+)\s*day[s]?\s*ago', 'days'),
            (r'(\d+)\s*week[s]?\s*ago', 'weeks'),
            (r'(\d+)\s*month[s]?\s*ago', 'months'),
            (r'(\d+)\s*year[s]?\s*ago', 'years'),
            # Korean patterns
            (r'(\d+)\s*초\s*전', 'seconds'),
            (r'(\d+)\s*분\s*전', 'minutes'),
            (r'(\d+)\s*시간\s*전', 'hours'),
            (r'(\d+)\s*일\s*전', 'days'),
            (r'(\d+)\s*주\s*전', 'weeks'),
            (r'(\d+)\s*개월\s*전', 'months'),
            (r'(\d+)\s*달\s*전', 'months'),
            (r'(\d+)\s*년\s*전', 'years'),
        ]

        for pattern, unit in patterns:
            match = re.search(pattern, time_str)
            if match:
                value = int(match.group(1))
                if unit == 'seconds':
                    return now - timedelta(seconds=value)
                elif unit == 'minutes':
                    return now - timedelta(minutes=value)
                elif unit == 'hours':
                    return now - timedelta(hours=value)
                elif unit == 'days':
                    return now - timedelta(days=value)
                elif unit == 'weeks':
                    return now - timedelta(weeks=value)
                elif unit == 'months':
                    return now - timedelta(days=value * 30)
                elif unit == 'years':
                    return now - timedelta(days=value * 365)

        return None
    except Exception:
        return None


def parse_serpapi_datetime(date_str: str) -> Optional[datetime]:
    """
    Parse SerpAPI datetime format: '01/27/2026, 02:06 AM, +0000 UTC'
    Returns timezone-aware datetime in UTC
    """
    try:
        from datetime import timezone
        # Remove UTC timezone info and parse
        # Format: MM/DD/YYYY, HH:MM AM/PM, +0000 UTC
        date_str = date_str.replace(', +0000 UTC', '').strip()

        # Parse with strptime and make it timezone-aware (UTC)
        dt = datetime.strptime(date_str, '%m/%d/%Y, %I:%M %p')
        return dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def parse_published_date(date_str: str, source: str = 'google') -> Optional[datetime]:
    """
    Parse published date based on source.
    Supports multiple formats:
    - SerpAPI format: '01/27/2026, 02:06 AM, +0000 UTC'
    - RFC2822: 'Wed, 29 Jan 2026 10:30:00 GMT'
    - Relative time: '2시간 전', '2 hours ago'
    """
    if not date_str:
        return None

    # Try SerpAPI datetime format first (most common)
    result = parse_serpapi_datetime(date_str)
    if result:
        return result

    # Try relative time (Korean and English)
    if source.lower() == 'naver':
        return parse_naver_date(date_str)
    else:
        # Try Google relative time
        result = parse_google_relative_time(date_str)
        if result:
            return result
        # Fallback to RFC2822 parser
        return parse_naver_date(date_str)
