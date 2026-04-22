export function chunkSectionBodies(
  sections: Array<{
    sectionPath: string;
    heading: string | null;
    ordinal: number;
    body: string;
  }>,
  maxLength = 900
) {
  const chunks: Array<{
    sectionPath: string;
    heading: string | null;
    ordinal: number;
    text: string;
  }> = [];

  for (const section of sections) {
    const paragraphs = section.body
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      continue;
    }

    let current = "";

    for (const paragraph of paragraphs) {
      const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

      if (candidate.length <= maxLength) {
        current = candidate;
        continue;
      }

      if (current) {
        chunks.push({
          sectionPath: section.sectionPath,
          heading: section.heading,
          ordinal: section.ordinal,
          text: current
        });
      }

      if (paragraph.length <= maxLength) {
        current = paragraph;
        continue;
      }

      let start = 0;
      while (start < paragraph.length) {
        chunks.push({
          sectionPath: section.sectionPath,
          heading: section.heading,
          ordinal: section.ordinal,
          text: paragraph.slice(start, start + maxLength)
        });
        start += maxLength;
      }

      current = "";
    }

    if (current) {
      chunks.push({
        sectionPath: section.sectionPath,
        heading: section.heading,
        ordinal: section.ordinal,
        text: current
      });
    }
  }

  return chunks;
}
