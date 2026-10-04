# Sources

`sources.json` registers every document a rule cites: its id, title, issuing
authority, languages and the SHA-256 of the exact file read. A citation is
only as good as the file it points at, so a different file under the same id
is an error — an amendment gets its own id.

The PDFs themselves are not in this repository. To run the second read
(`python -m pipeline.crosscheck`), place each as `sources/files/<doc_id>.pdf`;
the check refuses a file whose hash differs from the registry.

`pages/` holds a single-page extract of every page a verified rule cites, so a
citation can always be opened. See LICENSE-DATA.md for their status.
