import net from "net";

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

const normalizeUrlInput = (url: string) => {
  const trimmedUrl = url.trim();

  if (/^https?:\/\//i.test(trimmedUrl)) return trimmedUrl;

  return `https://${trimmedUrl}`;
};

const isPrivateIPv4 = (ip: string) => {
  const parts = ip.split(".").map(Number);
  const [first = 0, second = 0, third = 0, fourth = 0] = parts;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224 ||
    (first === 255 && second === 255 && third === 255 && fourth === 255)
  );
};

const isPrivateIPv6 = (ip: string) => {
  const normalizedIp = ip.toLowerCase();
  const mappedIPv4 = normalizedIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];

  if (mappedIPv4) return isPrivateIPv4(mappedIPv4);

  return (
    normalizedIp === "::" ||
    normalizedIp === "::1" ||
    normalizedIp.startsWith("fc") ||
    normalizedIp.startsWith("fd") ||
    normalizedIp.startsWith("fe80:")
  );
};

export const isPrivateAddress = (address: string) => {
  const ipType = net.isIP(address);

  if (ipType === 4) return isPrivateIPv4(address);
  if (ipType === 6) return isPrivateIPv6(address);

  return false;
};

export const getSafeExternalUrl = (url: string) => {
  const parsedUrl = new URL(normalizeUrlInput(url));

  if (!HTTP_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed.");
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("URLs with embedded credentials are not allowed.");
  }

  if (net.isIP(parsedUrl.hostname) && isPrivateAddress(parsedUrl.hostname)) {
    throw new Error("Internal network URLs are not allowed.");
  }

  return parsedUrl;
};

export const isSafeExternalUrl = (url?: string) => {
  if (!url) return false;

  try {
    getSafeExternalUrl(url);
    return true;
  } catch (error) {
    return false;
  }
};
