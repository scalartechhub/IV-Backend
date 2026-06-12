import { PDFParse } from "pdf-parse";

export const extractPdfText = async (
  buffer: Buffer
): Promise<{ text: string; numpages: number }> => {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  return {
    text: result.text.trim(),
    numpages: result.total ?? 1,
  };
};
