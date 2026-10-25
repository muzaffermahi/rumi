---
name: research-brief
description: Research a question on the web and hand back a short, sourced brief. Use for questions about competitors, markets, prices, products, people, laws, or anything that depends on current facts.
---

# Research brief

The user asked a question they will act on. Bring back what is true, where it comes from, and what it means for them.

## Search

1. Write a short plan: the 3–6 sub-questions that together answer the task.
2. Run one specific search per sub-question. Use names, years and places, not generic phrases. Rephrase instead of repeating a query that failed.
3. Read the best 2–5 pages with `read_page`. Prefer primary sources: official sites, pricing pages, filings, papers, documentation, laws. Use news or blogs to find primary sources, not to replace them.
4. When sources disagree, say so and say which one you trust and why.

## Hand back (finish)

- **answer**: lead with the conclusion in one or two sentences, then the supporting points. Short paragraphs or a compact list or table. Every specific fact (number, price, date, claim about a company) gets an inline source link.
- Relate the findings to the user's project from the brief and the passage. What does this mean for them?
- **notes**: sources consulted, with one line on what each contributed; what you could not verify; what changes fast and should be rechecked.
- Write a separate `.md` report and offer it only when the material is too long for the answer. The answer then summarises it.

## Avoid

- Answering from memory when a fact can be checked.
- Padding: background the user did not ask for, definitions of obvious terms, "it depends" without saying on what.
- Inventing numbers or URLs. If you could not find something, say so.
