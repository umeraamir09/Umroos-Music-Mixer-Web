export function SocialImage() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        alignItems: "center",
        backgroundColor: "#f7f3ec",
        color: "#3c2d31",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, width: 14, height: "100%", backgroundColor: "#f386a1" }} />
      <div style={{ width: 690, height: "100%", padding: "56px 0 56px 76px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 54, height: 54, borderRadius: 999, backgroundColor: "#3c2d31", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 31, height: 31, borderRadius: 999, backgroundColor: "#f386a1", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: "#3c2d31" }} />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-1px" }}>umroo&apos;s</span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "3px" }}>MUSIC MIXER</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "4px", color: "#d85e80" }}>YOUR SOUND, REIMAGINED</span>
          <span style={{ fontSize: 74, lineHeight: 0.98, fontWeight: 800, letterSpacing: "-5px" }}>Playlists</span>
          <span style={{ fontSize: 68, lineHeight: 1, fontWeight: 700, letterSpacing: "-4px" }}>by your taste.</span>
          <span style={{ maxWidth: 590, marginTop: 12, fontSize: 23, lineHeight: 1.4, color: "#75696b" }}>Familiar favorites, fresh discoveries, all shaped around you.</span>
        </div>

        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "2px", color: "#75696b" }}>A LITTLE MORE YOU IN EVERY MIX</span>
      </div>

      <div style={{ position: "absolute", right: -112, top: 72, width: 520, height: 520, borderRadius: 999, backgroundColor: "#3c2d31", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 448, height: 448, borderRadius: 999, border: "2px solid #6f5b61", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 362, height: 362, borderRadius: 999, border: "2px solid #6f5b61", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 270, height: 270, borderRadius: 999, border: "2px solid #6f5b61", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 154, height: 154, borderRadius: 999, backgroundColor: "#f386a1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ width: 18, height: 18, borderRadius: 999, backgroundColor: "#3c2d31" }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
