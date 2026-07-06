import { PDFParse } from "pdf-parse";

const MAX_PDF_TEXT_CHARS = 20_000;

export const extractPdfText = async (
  buffer: Buffer
): Promise<{ text: string; numpages: number }> => {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const result = await parser.getText();
    const text = result.text.trim().slice(0, MAX_PDF_TEXT_CHARS);
    return {
      text,
      numpages: result.total ?? 1,
    };
  } finally {
    await parser.destroy();
  }
};
