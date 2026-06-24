# Whitespace and Line Endings

These rules keep files clean for copying and pasting.

## Trailing Whitespace

- No trailing whitespace at end of lines: no tabs, spaces, or any other
  whitespace characters.
- Trailing whitespace is invisible, pollutes diffs, and is carried along
  when text is copied.

## Line Endings

- Use LF line endings exclusively.
- No CRLF.

## Markdown and HTML for Human Consumption

- Prefer no line endings in the middle of a paragraph. Leave it to the
  displaying application to soft-wrap lines.

## Preformatted Code Snippets

- Do not indent fenced code blocks; start them flush left.
- Do not use indentation as the mechanism for marking a code block (a
  leading run of spaces/tabs is copied verbatim and must be stripped by
  hand).
- Prefer fenced blocks (```` ``` ````) so the snippet's content begins
  at column 0 and pastes cleanly.
