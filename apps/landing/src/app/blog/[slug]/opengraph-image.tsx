import { ImageResponse } from "next/og";
import { postBySlug, POSTS } from "@/lib/blog/posts";

export const alt = "ModelStill blog post";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

const BACKGROUND: Record<string, string> = {
  leaf: "linear-gradient(180deg, #b7bcbb 0%, #d9cdb3 40%, #a9a47c 60%, #cdb68b 100%)",
  sun: "linear-gradient(180deg, #cdd3d3 0%, #8fa4b9 45%, #b7704a 65%, #d9b071 100%)",
  sky: "linear-gradient(180deg, #b9c2cf 0%, #d0cdc9 40%, #dcc4a0 70%, #c7a67c 100%)",
  plum: "linear-gradient(180deg, #c9938a 0%, #a9b0c0 30%, #96c0d6 55%, #9c6f7c 100%)",
};

export function generateStaticParams() {
  return POSTS.map((post) => ({ slug: post.slug }));
}

export default async function PostImage({ params }: { params: Promise<{ slug: string }> }) {
  const post = postBySlug((await params).slug) ?? POSTS[0]!;
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", padding: 56, backgroundImage: BACKGROUND[post.art.tone] }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", background: "rgba(255,255,255,0.94)", borderRadius: 28, padding: "56px 64px" }}>
        <div style={{ display: "flex", fontSize: 30, color: "#6b8e12", letterSpacing: 1 }}>{post.tags[0]}</div>
        <div style={{ display: "flex", fontSize: 62, lineHeight: 1.1, color: "#1f2a14", letterSpacing: -1.5 }}>{post.title}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 28, color: "#6f6f6f" }}>
          <span style={{ fontSize: 40, fontWeight: 700, color: "#1b1b1b", letterSpacing: -1.5 }}>modelstill</span>
          <span>modelstill.com/blog</span>
        </div>
      </div>
    </div>,
    size,
  );
}
