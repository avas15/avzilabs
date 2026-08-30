"""
Build the official word lists for Cat Dog Fish.

Run at build time, never at runtime. A party game must not break because a
SPARQL endpoint is slow, so everything is fetched here, normalised, and
committed as compact JSON that the Durable Object seeds from.

    python scripts/build-dictionaries.py

Sources, all permissively licensed:

  Wikidata          CC0            given names, films, chocolate, drinks
  dwyl/english-words Unlicense     general English, for the open categories
  dariusk/corpora   CC0            countries

Open Food Facts was considered for chocolate and rejected: it is ODbL, whose
share-alike clause would oblige this repo to license its derived database under
ODbL too. Wikidata gives adequate coverage at CC0.

Normalisation MUST match `normalise()` in src/game.ts exactly, or a word will be
stored in one form and looked up in another and silently never match.
"""
from __future__ import annotations

import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "src" / "dictionaries.json"
UA = "avzilabs-catdogfish/1.0 (https://avzilabs.com; hello@avzilabs.com)"
SPARQL = "https://query.wikidata.org/sparql"


# --------------------------------------------------------------- normalisation

_ARTICLE = re.compile(r"^(the|a|an)\s+")
_STRIP = re.compile(r"[^a-z0-9\s-]")
_WS = re.compile(r"\s+")


def normalise(raw: str) -> str:
    """Mirror of normalise() in src/game.ts. Keep the two in step."""
    s = unicodedata.normalize("NFD", raw)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    s = _STRIP.sub("", s)
    s = _WS.sub(" ", s).strip()
    return _ARTICLE.sub("", s)


def usable(word: str) -> bool:
    """
    Reject entries that would make the dictionary worse than no dictionary.

    Single letters and two-letter fragments are the specific problem: the plain
    word list contains "l" and "kl", which is exactly how a single letter scored
    ten points in a real game.
    """
    if len(word) < 3:
        return False
    if not re.search(r"[a-z]", word):
        return False
    # Wikidata labels sometimes carry disambiguators or identifiers.
    if re.search(r"\bq\d{4,}\b", word):
        return False
    return True


# ------------------------------------------------------------------- fetching


def get(url: str, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def sparql(query: str, attempts: int = 3) -> list[str] | None:
    """
    Run a SPARQL query and return the ?l column.

    Returns None if the query FAILED, and [] if it succeeded and matched
    nothing. The distinction matters: no chocolate begins with X, which is
    data, whereas a 504 is a broken source. Collapsing both to [] makes it
    impossible to tell a sparse category from a dead endpoint.
    """
    url = SPARQL + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    for n in range(attempts):
        try:
            data = json.loads(get(url, timeout=300))
            return [b["l"]["value"] for b in data["results"]["bindings"]]
        except Exception as e:
            if n == attempts - 1:
                print(f"    query failed after {attempts} attempts: {str(e)[:90]}")
                return None
            time.sleep(5 * (n + 1))
    return []


LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# Query failures tolerated before the whole build is rejected. Empty results
# are not failures: a category may genuinely have nothing under some letters.
MAX_FAILED_LETTERS = 2


class IncompleteSource(RuntimeError):
    """Raised when a source returned too little to trust."""


def by_letter(make_query, label: str) -> list[str]:
    """
    Fetch a large result set one initial letter at a time.

    LIMIT/OFFSET paging does not work here: WDQS needs ORDER BY for stable
    offsets, and sorting a large result set is exactly what exceeds the query
    timeout (504). Partitioning on the first letter keeps every query small and
    fast, and it is deterministic without needing a sort.
    """
    seen: set[str] = set()
    failed: list[str] = []
    empty: list[str] = []
    for ch in LETTERS:
        rows = sparql(make_query(ch), attempts=2)
        if rows is None:
            failed.append(ch)
            continue
        if not rows:
            empty.append(ch)
        seen.update(rows)

    print(f"      {label}: {len(seen)} labels"
          + (f"  [{len(empty)} letters legitimately empty]" if empty else "")
          + (f"  [FAILED: {''.join(failed)}]" if failed else ""))

    """
    Refuse a partial result rather than returning one.

    A dictionary missing most of its letters is worse than no dictionary: it
    silently rejects valid answers, and it looks like it worked. An earlier run
    of this script wrote a film list covering two letters out of twenty-six and
    exited zero, which is exactly the failure this guard exists to stop.
    """
    if len(failed) > MAX_FAILED_LETTERS:
        raise IncompleteSource(
            f"{label}: {len(failed)} of {len(LETTERS)} queries FAILED "
            f"({''.join(failed)}). Refusing to build a partial dictionary."
        )
    return sorted(seen)


def wikidata_class(qid: str) -> list[str]:
    """English labels for everything under a Wikidata class."""
    return by_letter(lambda ch:
        f'SELECT DISTINCT ?l WHERE {{ ?x wdt:P279* wd:{qid} ; rdfs:label ?l . '
        f'FILTER(LANG(?l)="en") FILTER(STRSTARTS(?l,"{ch}")) }} LIMIT 20000',
        f"class {qid}")


def wikidata_instances(qid: str) -> list[str]:
    return by_letter(lambda ch:
        f'SELECT DISTINCT ?l WHERE {{ ?x wdt:P31 wd:{qid} ; rdfs:label ?l . '
        f'FILTER(LANG(?l)="en") FILTER(STRSTARTS(?l,"{ch}")) }} LIMIT 20000',
        f"instances of {qid}")


def wikidata_films() -> list[str]:
    """
    Films that have an English Wikipedia article.

    Wikidata holds hundreds of thousands of films, most of them shorts and
    regional releases nobody could name. Requiring a sitelink keeps the list to
    films a player might plausibly write, and keeps it a sane size.
    """
    return by_letter(lambda ch:
        'SELECT DISTINCT ?l WHERE { '
        f'?f wdt:P31 wd:Q11424 ; rdfs:label ?l . '
        '?a schema:about ?f ; schema:isPartOf <https://en.wikipedia.org/> . '
        f'FILTER(LANG(?l)="en") FILTER(STRSTARTS(?l,"{ch}")) }} LIMIT 20000',
        "films")


# ------------------------------------------------------------------ the build


def build() -> None:
    out: dict[str, list[str]] = {}

    def add(category: str, words: list[str], note: str) -> None:
        clean = sorted({n for w in words if (n := normalise(w)) and usable(n)})
        out[category] = clean
        print(f"  {category:12} {len(clean):>6} entries   {note}")

    print("Building official dictionaries\n")

    print("  smashew/NameDatabases (Unlicense)")
    names = get("https://raw.githubusercontent.com/smashew/NameDatabases/"
                "master/NamesDatabases/first%20names/all.txt").decode("utf-8", "replace").splitlines()
    """
    One combined list for both name categories, deliberately.

    The source is not gendered, and that is the better outcome rather than a
    limitation to work around. Which names are "boys' names" is contested and
    varies by culture, so a dictionary that ruled on it would reject valid
    answers and make a pronouncement it has no business making. The list
    answers "is this a real given name", and the table settles the rest by
    protest, which is what the vote is for.
    """
    add("Boy name", names, "given names, not gender-split (see note)")
    add("Girl name", names, "same list; gender left to the table")

    print("")
    print("  Wikidata (CC0)")
    add("Drink", wikidata_class("Q40050"), "drinks and subclasses")
    add("Chocolate", wikidata_class("Q195"), "chocolate and subclasses")

    """
    Film is deliberately left without a dictionary.

    No permissively licensed film list of usable coverage was found. Wikidata
    has the data but the query service could only return two letters out of
    twenty-six before timing out, and a film list missing most of the alphabet
    would reject valid answers while looking like it worked. An absent
    dictionary is honest; a broken one is not. Film falls back to the letter
    rule plus the protest vote.
    """

    print("")
    print("  corpora (CC0)")
    countries = json.loads(get("https://raw.githubusercontent.com/dariusk/corpora/"
                               "master/data/geography/countries.json"))["countries"]
    add("Country", countries, "sovereign states")

    print("")
    print("  dwyl/english-words (Unlicense)")
    words = get("https://raw.githubusercontent.com/dwyl/english-words/"
                "master/words_alpha.txt").decode("utf-8", "replace").split()
    add("Animal", words, "general English; wrong-category answers left to the vote")

    total = sum(len(v) for v in out.values())
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    size = OUT.stat().st_size
    print(f"\n  wrote {OUT.name}: {total} entries, {size/1024/1024:.2f} MB")

    # Regression check against the answers from the game that prompted this.
    print("\n  checking the answers that were scored wrongly")
    for word, cat, want in [
        ("lasfo", "Animal", False),
        ("l", "Animal", False),
        ("lion", "Animal", True),
        ("loretta", "Girl name", True),
        ("leon", "Boy name", True),
        ("lyon", "Country", False),
        ("france", "Country", True),
        ("lamp", "Drink", False),
        ("long island iced tea", "Drink", True),
    ]:
        got = word in set(out.get(cat, []))
        flag = "ok " if got == want else "MISS"
        print(f"    [{flag}] {word!r:22} in {cat:11} -> {got}  (expected {want})")


if __name__ == "__main__":
    try:
        build()
    except KeyboardInterrupt:
        sys.exit(1)
