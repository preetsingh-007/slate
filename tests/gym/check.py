#!/usr/bin/env python3
"""Validate repository structure, indexes, front matter, placeholders, links, and
the app-owned journal/ and library/ folders.

Usage: python3 scripts/check.py

Prints each error and exits with status 1 if any check fails.
"""

import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
NON_DOMAINS = {"log", "templates", "scripts", "journal", "library"}
UNIT_PARTS = {"README.md", "notes.md", "notes", "problems", "code", "assets"}

NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
PROBLEM_FILE = re.compile(r"^\d{3}-[a-z0-9]+(-[a-z0-9]+)*\.md$")
NOTE_FILE = re.compile(r"^\d{2}-[a-z0-9]+(-[a-z0-9]+)*\.md$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
LINK = re.compile(r"!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
FENCE = re.compile(r"^[ \t]*(```|~~~).*?^[ \t]*\1", re.S | re.M)
INLINE_CODE = re.compile(r"`[^`\n]*`")
PLACEHOLDER = re.compile(r"<[^<>\n]+>")
LOG_HEADING = re.compile(r"^## (.+)$", re.M)
MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
ASSET_FILE = re.compile(r"^[0-9a-f]{16,64}(\.[a-z0-9]+)?$")
DAY_FILE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.(md|svg)$")
MARK_FILE = re.compile(r"^([a-z0-9]+(?:-[a-z0-9]+)*)\.(md|png)$")
CLIPPING_DIR = re.compile(r"^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$")
QUEUE_LINE = re.compile(
    r"^- \[([a-z0-9]+(?:-[a-z0-9]+)*)\]\(([^)\s]+)\) · (note|problem|solution|question)"
    r" · (.+) · (\d{4}-\d{2}-\d{2})$")
FORMALIZED_LINE = re.compile(
    r"^- ([a-z0-9]+(?:-[a-z0-9]+)*) → (dismissed|[^\s#]+(?:#\S+)?) · (\d{4}-\d{2}-\d{2})$")

TOPIC_STATUS = {"planned", "active", "done"}
PROBLEM_STATUS = {"open", "solved", "revisit"}
DIFFICULTY = {"easy", "medium", "hard"}
MARK_KINDS = {"note", "problem", "solution", "question"}

JOURNAL_FILES = {"README.md", "queue.md", "todo.yjs", "todos.md", "formalized.md"}
SEGMENT_FILES = {"canvas.yjs"}
SEGMENT_DIRS = {"days", "marks", "assets"}
BOOK_FILES = {"book.json", "annotations.yjs", "annotations.md", "book.pdf", "book.epub"}
CLIPPING_FILES = {"clipping.md", "snapshot.html", "meta.json", "annotations.yjs", "annotations.md"}

errors = []


def error(path, message):
    errors.append(f"{path.relative_to(ROOT).as_posix()}: {message}")


def tracked_files():
    """Files tracked or untracked-but-not-ignored, relative to ROOT."""
    out = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout
    return {Path(p) for p in out.split("\0") if p and (ROOT / p).exists()}


FILES = tracked_files()


def children(rel_dir):
    """Names of immediate entries of a directory, split into files and dirs."""
    files, dirs = set(), set()
    depth = len(rel_dir.parts)
    for f in FILES:
        if f.parts[:depth] == rel_dir.parts and len(f.parts) > depth:
            (files if len(f.parts) == depth + 1 else dirs).add(f.parts[depth])
    return files, dirs


def strip_code(text):
    return INLINE_CODE.sub("", FENCE.sub("", text))


def front_matter(path):
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 4)
    if end == -1:
        return None
    fields = {}
    for line in text[4:end].splitlines():
        key, sep, value = line.partition(":")
        if sep:
            fields[key.strip()] = value.strip().strip("\"'")
    return fields


def link_targets(path):
    """Resolved local paths linked from a Markdown file."""
    targets = set()
    for target in LINK.findall(strip_code(path.read_text(encoding="utf-8"))):
        if "://" in target or target.startswith(("mailto:", "#")):
            continue
        target = unquote(target.split("#", 1)[0].split("?", 1)[0])
        base = ROOT if target.startswith("/") else path.parent
        targets.add(Path(os.path.normpath(base / target.lstrip("/"))))
    return targets


def require_indexed(parent_readme, child_dir):
    links = link_targets(parent_readme) if parent_readme.exists() else set()
    if child_dir not in links and child_dir / "README.md" not in links:
        error(child_dir, f"not linked from {parent_readme.relative_to(ROOT)}")


def check_name(path):
    if not NAME.match(path.name):
        error(path, "name must be lowercase and hyphen-separated")


def check_readme(rel_dir):
    if Path(rel_dir, "README.md") not in FILES:
        error(ROOT / rel_dir, "missing README.md")


def check_status(readme):
    fields = front_matter(readme)
    if fields is None:
        error(readme, "missing front matter")
        return
    status = fields.get("status", "")
    started, completed = fields.get("started", ""), fields.get("completed", "")
    if status not in TOPIC_STATUS:
        error(readme, f"status must be one of {sorted(TOPIC_STATUS)}")
    for key, value in (("started", started), ("completed", completed)):
        if value and not DATE.match(value):
            error(readme, f"{key} must be YYYY-MM-DD")
    if status in {"active", "done"} and not started:
        error(readme, f"status {status} requires started")
    if status == "done" and not completed:
        error(readme, "status done requires completed")


def check_problem(path):
    fields = front_matter(path)
    if fields is None:
        error(path, "missing front matter")
        return
    if not fields.get("source"):
        error(path, "source is empty")
    if fields.get("difficulty") not in DIFFICULTY:
        error(path, f"difficulty must be one of {sorted(DIFFICULTY)}")
    if fields.get("status") not in PROBLEM_STATUS:
        error(path, f"status must be one of {sorted(PROBLEM_STATUS)}")
    if not DATE.match(fields.get("date", "")):
        error(path, "date must be YYYY-MM-DD")


def check_unit(rel_dir, is_variant):
    """Check a topic or variant directory. Returns True if it has variants."""
    path = ROOT / rel_dir
    files, dirs = children(rel_dir)
    variants = sorted(d for d in dirs if d not in UNIT_PARTS)

    for name in files - UNIT_PARTS:
        error(path / name, "unexpected file; see README.md, Subjects and topics")
    for name in dirs & {"README.md", "notes.md"}:
        error(path / name, "must be a file")
    if "notes.md" in files and "notes" in dirs:
        error(path, "has both notes.md and notes/")

    if "problems" in dirs:
        p_files, p_dirs = children(rel_dir / "problems")
        for name in p_dirs:
            error(path / "problems" / name, "problems/ must not contain directories")
        for name in sorted(p_files):
            if PROBLEM_FILE.match(name):
                check_problem(path / "problems" / name)
            else:
                error(path / "problems" / name, "name must be NNN-<slug>.md")
    if "notes" in dirs:
        n_files, n_dirs = children(rel_dir / "notes")
        for name in n_dirs:
            error(path / "notes" / name, "notes/ must not contain directories")
        for name in n_files - {name for name in n_files if NOTE_FILE.match(name)}:
            error(path / "notes" / name, "name must be NN-<slug>.md")

    if is_variant and variants:
        for name in variants:
            error(path / name, "variants cannot contain variants")
        return False

    for name in variants:
        variant = rel_dir / name
        check_name(ROOT / variant)
        check_readme(variant)
        require_indexed(path / "README.md", ROOT / variant)
        check_unit(variant, is_variant=True)

    readme = path / "README.md"
    if variants:
        if "code" in dirs:
            error(path / "code", "a topic with variants keeps code in its variants")
        fields = front_matter(readme) if readme.exists() else None
        if fields and "status" in fields:
            error(readme, "a topic with variants records status in its variants")
    elif readme.exists():
        check_status(readme)
    return bool(variants)


def check_domains():
    _, top_dirs = children(Path("."))
    for domain in sorted(d for d in top_dirs if not d.startswith(".") and d not in NON_DOMAINS):
        d = Path(domain)
        check_name(ROOT / d)
        check_readme(d)
        require_indexed(ROOT / "README.md", ROOT / d)
        files, subjects = children(d)
        for name in files - {"README.md"}:
            error(ROOT / d / name, "domain directories contain only README.md and subjects")
        for subject in sorted(subjects):
            s = d / subject
            check_name(ROOT / s)
            check_readme(s)
            require_indexed(ROOT / d / "README.md", ROOT / s)
            files, topics = children(s)
            for name in files - {"README.md"}:
                error(ROOT / s / name, "subject directories contain only README.md and topics")
            for topic in sorted(topics):
                t = s / topic
                check_name(ROOT / t)
                check_readme(t)
                require_indexed(ROOT / s / "README.md", ROOT / t)
                check_unit(t, is_variant=False)


def check_log():
    for f in sorted(f for f in FILES if f.parts[0] == "log" and f != Path("log/README.md")):
        path = ROOT / f
        parts = f.parts
        if len(parts) != 3 or not re.match(r"^\d{4}$", parts[1]) \
                or not re.match(r"^(0[1-9]|1[0-2])\.md$", parts[2]):
            error(path, "log files must be log/YYYY/MM.md")
            continue
        month = f"{parts[1]}-{parts[2][:2]}"
        for heading in LOG_HEADING.findall(strip_code(path.read_text(encoding="utf-8"))):
            if not (DATE.match(heading) and heading.startswith(month)):
                error(path, f"heading '## {heading}' must be a date in {month}")


def check_lines(path, pattern, what):
    """Check that every non-blank line after the title matches a line format."""
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip() and not line.startswith("#") and not pattern.match(line):
            error(path, f"line {n} is not a valid {what} line")


def check_fields(path, required):
    fields = front_matter(path)
    if fields is None:
        error(path, "missing front matter")
        return {}
    for key in required:
        if key not in fields:
            error(path, f"front matter lacks {key}")
    return fields


def check_assets(rel_dir):
    files, dirs = children(rel_dir)
    for name in dirs:
        error(ROOT / rel_dir / name, "assets/ must not contain directories")
    for name in files:
        if not ASSET_FILE.match(name):
            error(ROOT / rel_dir / name, "asset names must be a content hash")


def check_segment(rel_dir, canvas):
    path = ROOT / rel_dir
    files, dirs = children(rel_dir)
    for name in files - SEGMENT_FILES:
        error(path / name, "unexpected file in a canvas segment")
    for name in dirs - SEGMENT_DIRS:
        error(path / name, "unexpected directory in a canvas segment")
    if "canvas.yjs" not in files:
        error(path, "missing canvas.yjs")
    if "assets" in dirs:
        check_assets(rel_dir / "assets")
    if "days" in dirs:
        d_files, d_dirs = children(rel_dir / "days")
        for name in d_dirs:
            error(path / "days" / name, "days/ must not contain directories")
        for name in sorted(d_files):
            m = DAY_FILE.match(name)
            if not m or not m.group(1).startswith(rel_dir.name):
                error(path / "days" / name, f"name must be YYYY-MM-DD.md or .svg in {rel_dir.name}")
                continue
            if m.group(2) == "md":
                fields = check_fields(path / "days" / name, ("canvas", "date", "topics"))
                if fields.get("date", m.group(1)) != m.group(1):
                    error(path / "days" / name, "date must match the file name")
                if fields.get("canvas", canvas) != canvas:
                    error(path / "days" / name, f"canvas must be {canvas}")
    if "marks" in dirs:
        m_files, m_dirs = children(rel_dir / "marks")
        for name in m_dirs:
            error(path / "marks" / name, "marks/ must not contain directories")
        for name in sorted(m_files):
            m = MARK_FILE.match(name)
            if not m:
                error(path / "marks" / name, "name must be <mark id>.md or .png")
                continue
            if m.group(2) != "md":
                continue
            mark = path / "marks" / name
            fields = check_fields(
                mark, ("id", "kind", "topic", "problem", "comment", "created", "day"))
            if fields.get("id", m.group(1)) != m.group(1):
                error(mark, "id must match the file name")
            if fields and fields.get("kind") not in MARK_KINDS:
                error(mark, f"kind must be one of {sorted(MARK_KINDS)}")
            day = fields.get("day", "")
            if day and not (mark.parent / day).exists():
                error(mark, f"day links to missing {day}")


def check_journal():
    rel = Path("journal")
    files, canvases = children(rel)
    if not files and not canvases:
        return
    for name in files - JOURNAL_FILES:
        error(ROOT / rel / name, "unexpected file in journal/")
    if "README.md" not in files:
        error(ROOT / rel, "missing README.md")
    if "queue.md" in files:
        check_lines(ROOT / rel / "queue.md", QUEUE_LINE, "queue")
    if "formalized.md" in files:
        formalized = ROOT / rel / "formalized.md"
        check_lines(formalized, FORMALIZED_LINE, "formalized")
        for line in formalized.read_text(encoding="utf-8").splitlines():
            m = FORMALIZED_LINE.match(line)
            if m and m.group(2) != "dismissed":
                target = formalized.parent / unquote(m.group(2).split("#", 1)[0])
                if not target.exists():
                    error(formalized, f"{m.group(1)} points to missing {m.group(2)}")
    for canvas in sorted(canvases):
        c = rel / canvas
        check_name(ROOT / c)
        c_files, months = children(c)
        for name in c_files - {"canvas.json"}:
            error(ROOT / c / name, "a canvas folder contains only canvas.json and months")
        if "canvas.json" not in c_files:
            error(ROOT / c, "missing canvas.json")
        for month in sorted(months):
            if MONTH.match(month):
                check_segment(c / month, canvas)
            else:
                error(ROOT / c / month, "canvas segments must be named YYYY-MM")


def check_library():
    rel = Path("library")
    files, dirs = children(rel)
    if not files and not dirs:
        return
    for name in files - {"README.md", "settings.json"}:
        error(ROOT / rel / name, "unexpected file in library/")
    for name in dirs - {"books", "clippings"}:
        error(ROOT / rel / name, "library/ contains only books/ and clippings/")
    if "README.md" not in files:
        error(ROOT / rel, "missing README.md")
    if "books" in dirs:
        b_files, books = children(rel / "books")
        for name in b_files:
            error(ROOT / rel / "books" / name, "books/ contains only book folders")
        for book in sorted(books):
            b = rel / "books" / book
            check_name(ROOT / b)
            f, d = children(b)
            for name in f - BOOK_FILES:
                error(ROOT / b / name, "unexpected file in a book folder")
            for name in d:
                error(ROOT / b / name, "a book folder must not contain directories")
            if "book.json" not in f:
                error(ROOT / b, "missing book.json")
    if "clippings" in dirs:
        c_files, clippings = children(rel / "clippings")
        for name in c_files:
            error(ROOT / rel / "clippings" / name, "clippings/ contains only clipping folders")
        for clipping in sorted(clippings):
            c = rel / "clippings" / clipping
            if not CLIPPING_DIR.match(clipping):
                error(ROOT / c, "name must be YYYY-MM-DD-<slug>")
            f, d = children(c)
            for name in f - CLIPPING_FILES:
                error(ROOT / c / name, "unexpected file in a clipping folder")
            for name in d - {"assets"}:
                error(ROOT / c / name, "a clipping folder contains only assets/")
            for name in ("clipping.md", "meta.json"):
                if name not in f:
                    error(ROOT / c, f"missing {name}")
            if "assets" in d:
                check_assets(c / "assets")


def check_links():
    for f in sorted(f for f in FILES if f.suffix == ".md" and f.parts[0] != "templates"):
        path = ROOT / f
        for target in sorted(link_targets(path)):
            if not target.exists():
                error(path, f"broken link to {os.path.relpath(target, path.parent)}")


def check_placeholders():
    tokens = set()
    for f in FILES:
        if f.parts[0] == "templates" and f.suffix == ".md":
            tokens |= set(PLACEHOLDER.findall((ROOT / f).read_text(encoding="utf-8")))
    for f in sorted(FILES):
        if f.suffix != ".md" or f.parts[0].startswith(".") \
                or f.parts[0] in {"templates", "scripts", "journal", "library"}:
            continue
        if len(f.parts) == 1:
            continue
        text = strip_code((ROOT / f).read_text(encoding="utf-8"))
        found = sorted(t for t in set(PLACEHOLDER.findall(text)) if t in tokens)
        if found:
            error(ROOT / f, f"unreplaced placeholders: {', '.join(found)}")


def check_skills():
    skills_dir, links_dir = ROOT / ".agents" / "skills", ROOT / ".claude" / "skills"
    _, skills = children(Path(".agents/skills"))
    for name in sorted(skills):
        skill = skills_dir / name / "SKILL.md"
        fields = front_matter(skill) if skill.exists() else None
        if fields is None:
            error(skills_dir / name, "missing SKILL.md with front matter")
        else:
            if fields.get("name") != name:
                error(skill, "name must equal the directory name")
            if not fields.get("description"):
                error(skill, "description is empty")
        link = links_dir / name
        if not link.is_symlink() or link.resolve() != (skills_dir / name).resolve():
            error(link, f"must be a symlink to ../../.agents/skills/{name}")
    if links_dir.is_dir():
        for link in sorted(links_dir.iterdir()):
            if link.name not in skills:
                error(link, "has no matching directory in .agents/skills/")


def main():
    check_domains()
    check_log()
    check_journal()
    check_library()
    check_links()
    check_placeholders()
    check_skills()
    for message in sorted(set(errors)):
        print(message)
    if errors:
        print(f"\n{len(set(errors))} error(s)")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
