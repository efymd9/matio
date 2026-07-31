# Architecture Decision Records

An ADR records a decision whose consequences outlive the PR that made it: a
choice of library or vendor, a data-model shape, a protocol, a security or
privacy boundary, a deliberate trade-off someone will want to re-litigate in six
months. Routine implementation choices do not need one.

The value is in the *why*: an ADR that only states what was chosen is a comment,
not a record. Write down what was rejected and what it would cost to reverse.

## Format

One file per decision, `NNNN-slug.md`, numbered sequentially, never renumbered.
Superseding an old decision does not delete it — the old file gets a
`Superseded by NNNN` line and stays.

```markdown
# NNNN. Short decision title

Date: YYYY-MM-DD
Status: Proposed | Accepted | Superseded by NNNN

## Context

The forces at play: constraints, what we measured, what we already have in the
codebase, what alternatives existed.

## Decision

What we decided, stated so that a reader can act on it.

## Consequences

What becomes easier, what becomes harder, what we accept as a known cost, and
what has to be revisited if a stated assumption stops holding.
```

## Records

_(none yet)_
