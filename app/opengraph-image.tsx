import { ImageResponse } from "next/og";

export const alt = "MailPiston - Own the inbox. Offload the mail server.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#f8f4ea",
          color: "#10191c",
          display: "flex",
          fontFamily: "Arial, sans-serif",
          height: "100%",
          justifyContent: "center",
          overflow: "hidden",
          padding: "76px",
          position: "relative",
          width: "100%",
        }}
      >
        <div style={{ background: "#bfe1ee", borderRadius: 999, height: 520, position: "absolute", right: -150, top: -130, width: 520 }} />
        <div style={{ background: "#f1b5bb", borderRadius: 999, bottom: -230, height: 500, left: -190, opacity: .45, position: "absolute", width: 500 }} />

          <div style={{ display: "flex", flexDirection: "column", position: "relative", width: "100%" }}>
          <div style={{ alignItems: "center", display: "flex", fontSize: 28, fontWeight: 700, gap: 16 }}>
            <div style={{ alignItems: "center", background: "#10191c", borderRadius: 15, display: "flex", height: 52, justifyContent: "center", position: "relative", width: 52 }}>
              <div style={{ background: "#bfe1ee", borderRadius: 4, height: 23, position: "absolute", top: 11, width: 31 }} />
              <div style={{ background: "#f26b3a", borderRadius: 99, height: 9, position: "absolute", top: 18, width: 9 }} />
              <div style={{ background: "#fffdf7", height: 16, position: "absolute", top: 30, width: 7 }} />
            </div>
            MailPiston
          </div>

          <div style={{ display: "flex", flexDirection: "column", fontFamily: "Georgia, serif", fontSize: 83, letterSpacing: -5, lineHeight: .98, marginTop: 88, maxWidth: 900 }}>
            <span>Own the inbox.</span>
            <span style={{ color: "#c9461d", fontStyle: "italic" }}>Offload the mail server.</span>
          </div>

          <div style={{ alignItems: "center", display: "flex", fontSize: 22, gap: 18, marginTop: 55 }}>
            <span style={{ background: "#f26b3a", borderRadius: 99, height: 12, width: 12 }} />
            Your domains · Your data model · Proven delivery underneath
          </div>
        </div>
      </div>
    ),
    size,
  );
}
