import { ImageResponse } from "next/og";

export const alt = "CISS Workforce secure attendance and workforce operations";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(135deg, #061521 0%, #073453 58%, #014c85 100%)",
          color: "#f8fafc",
          padding: "68px 76px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
            backgroundSize: "76px 76px",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
            <div
              style={{
                width: "76px",
                height: "76px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid #d6b15f",
                borderRadius: "20px",
                background: "rgba(6,21,33,0.72)",
                color: "#e5c77f",
                fontSize: "28px",
                fontWeight: 800,
                letterSpacing: "-2px",
              }}
            >
              C
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: "38px", fontWeight: 800, letterSpacing: "-1px" }}>
                CISS Workforce
              </div>
              <div
                style={{
                  marginTop: "7px",
                  color: "#d6b15f",
                  fontSize: "19px",
                  fontWeight: 700,
                  letterSpacing: "5px",
                  textTransform: "uppercase",
                }}
              >
                CISS Services Limited
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", maxWidth: "930px" }}>
            <div
              style={{
                color: "#e5c77f",
                fontSize: "24px",
                fontWeight: 700,
                letterSpacing: "4px",
                textTransform: "uppercase",
              }}
            >
              Duty, verified
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: "14px",
                fontSize: "66px",
                lineHeight: 1.03,
                fontWeight: 800,
                letterSpacing: "-3px",
              }}
            >
              <span>Secure attendance.</span>
              <span>Connected operations.</span>
            </div>
            <div style={{ marginTop: "24px", color: "#c7d5df", fontSize: "24px" }}>
              Official workforce portal for guards, field officers, clients and administrators.
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
