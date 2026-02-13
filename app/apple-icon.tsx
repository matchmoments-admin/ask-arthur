import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          backgroundColor: "#001F3F",
          borderRadius: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#FFFFFF",
          fontSize: 100,
          fontWeight: 800,
          fontFamily: "sans-serif",
        }}
      >
        A
      </div>
    ),
    { ...size }
  );
}
