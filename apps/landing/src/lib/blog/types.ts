export type Tone = "leaf" | "sun" | "sky" | "plum";

export type Motif = "bars" | "intervals" | "layers" | "scales";

export type Post = {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  keyword?: string;
  art: { tone: Tone; motif: Motif };
};
