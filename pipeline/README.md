# pipeline

Python 3.11, offline checks on the rules. Nothing here runs when anyone looks
up a plot.

```
pip install -r pipeline/requirements.txt

python -m pipeline.crosscheck        # second read: each rule's value, quote and band
                                     # found in its cited box of the hashed PDF;
                                     # column order consistent across a table
python -m pipeline.watch             # new DDA / MCD notices since the last review
python -m pipeline.verify --by "<role>" --rule <id>   # reviewer sign-off
python -m pytest pipeline/tests
```

The second read narrows the reviewer's eye; it never verifies a rule. The
watcher announces; reading a notice and drafting any change stays with a
person.
