import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#f7f3ec" }}>
        <div style={{ width: 142, height: 142, borderRadius: 999, backgroundColor: "#3c2d31", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 112, height: 112, borderRadius: 999, border: "1px solid #725c63", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 78, height: 78, borderRadius: 999, border: "1px solid #725c63", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 42, height: 42, borderRadius: 999, backgroundColor: "#f386a1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: "#3c2d31" }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
