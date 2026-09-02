import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Renders a QR code (as an <img>) for the given URL. */
export function Qr({ url, size = 320 }: { url: string; size?: number }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: size,
      color: { dark: "#0d0819", light: "#ffffff" },
    })
      .then((d) => {
        if (alive) setSrc(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url, size]);
  if (!src) return <div className="qr-wrap" style={{ width: size, height: size }} />;
  return (
    <div className="qr-wrap">
      <img src={src} alt="رمز دخول الغرفة" />
    </div>
  );
}
