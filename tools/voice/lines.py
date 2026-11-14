"""Read the Broker test lines straight from the game's i18n file (read-only)."""
import re
from pathlib import Path

I18N = Path("/home/claude/heist/src/core/i18n.ts")
KEYS = ["intro1", "kit"]


def load_lines(keys=KEYS):
    """Return {('en'|'de', key): text} with the 'BROKER: ' prefix removed.

    The file contains every key twice: first the English block, then German.
    """
    src = I18N.read_text(encoding="utf-8")
    out = {}
    for key in keys:
        hits = re.findall(r"'sub\.%s':\s*'((?:[^'\\]|\\.)*)'" % re.escape(key), src)
        if len(hits) != 2:
            raise SystemExit(f"expected 2 hits for sub.{key}, got {len(hits)}")
        for lang, raw in zip(("en", "de"), hits):
            text = raw.replace("\\'", "'")
            text = re.sub(r"^BROKER:\s*", "", text)
            out[(lang, key)] = text
    return out


def all_sub_lines():
    """All sub.* lines per language (for length statistics)."""
    src = I18N.read_text(encoding="utf-8")
    hits = re.findall(r"'(sub\.[A-Za-z0-9]+)':\s*'((?:[^'\\]|\\.)*)'", src)
    seen, res = set(), {"en": [], "de": []}
    for k, raw in hits:
        lang = "de" if k in seen else "en"
        seen.add(k)
        res[lang].append(re.sub(r"^BROKER:\s*", "", raw.replace("\\'", "'")))
    return res


if __name__ == "__main__":
    for (lang, key), t in load_lines().items():
        print(lang, key, len(t), "|", t)
    for lang, ls in all_sub_lines().items():
        n = [len(x) for x in ls]
        print(lang, "lines", len(n), "avg chars", round(sum(n) / len(n), 1), "max", max(n), "total", sum(n))
