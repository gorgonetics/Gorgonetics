# v0.10.2

Breed now leans on the measured gene sizes, and gains a strategy for foals that breed their positives true.

- **Clarify positives** is a new strategy. It ranks pairs by how many more of their positives the foal is expected to breed true than the better parent does, meaning the foal is homozygous for the positive allele and always passes it on. Where the study has measured a gene, the gene counts by its measured points, so clarifying a +6 outranks clarifying a +1. It has its own **Clarify** column and a row in the Trio's score panel.
- **Net pts** is a new column: the per-attribute points columns added together, with a gap against the better parent. It is for reading, not ranking. It treats all attributes as equal, does not cap them at 100, and counts unmeasured genes as 0. The header says how much the study has measured.
- **Pool-weighted +** is removed from the table and from the Trio's highlights. **Quality** already rewards what it was trying to capture.
- **Total +** is now **+ genes**, so it reads as the count it is: one +5 gene and one +1 gene count the same.
- The breed-generic readout now shows its genome total, for example "176.5 of 179 reachable breed-generic (202 in the genome)". Slots that no animal in your breeding pool carries fall outside the reachable count, and the difference was hidden before.
