import sharp from "sharp";
import got from "got";

// Constants
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383;

// Utility function to determine if compression is needed
function shouldCompress(originType, originSize, isWebp) {
  const MIN_COMPRESS_LENGTH = isWebp ? 10000 : 50000;
  return (
    originType.startsWith("image") &&
    originSize >= MIN_COMPRESS_LENGTH &&
    !originType.endsWith("gif") // Skip GIFs for simplicity
  );
}

// Function to compress an image
async function compress(input, format, quality, grayscale) {
  const imagePipeline = sharp({ unlimited: true, animated: false });

  const sharpInstance = input.pipe(imagePipeline);

  const metadata = await sharpInstance.metadata();

  if (metadata.height > MAX_HEIGHT) {
    sharpInstance.resize({ height: MAX_HEIGHT });
  }

  if (grayscale) {
    sharpInstance.grayscale();
  }

  // Process the image and capture info
  const outputBuffer = await sharpInstance
    .toFormat(format, { quality })
    .toBuffer({ resolveWithObject: true });

  return { data: outputBuffer.data, info: outputBuffer.info };
}

// Function to handle image compression requests
export async function handleRequest(req, res) {
  const imageUrl = req.query.url;
  const isWebp = !req.query.jpeg;
  const grayscale = req.query.bw == "1";
  const quality = parseInt(req.query.quality, 10) || DEFAULT_QUALITY;
  const format = isWebp ? "webp" : "jpeg";

  if (!imageUrl) {
    return res.status(400).send("Image URL is required.");
  }

  try {
    const response = await got.stream(imageUrl);

    const originType = response.headers["content-type"];
    const originSize = parseInt(response.headers["content-length"], 10) || 0;

    if (shouldCompress(originType, originSize, isWebp)) {
      const { data: processedData, info } = await compress(response, format, quality, grayscale);

      res.setHeader("Content-Type", `image/${format}`);
      res.setHeader("Content-Length", processedData.length);
      res.setHeader("X-Original-Size", originSize);
      res.setHeader("X-Bytes-Saved", originSize - processedData.length);
      res.setHeader("X-Processed-Size", info.size);
      res.send(processedData);
    } else {
      res.setHeader("Content-Type", originType);
      res.setHeader("Content-Length", originSize);
      response.pipe(res);
    }
  } catch (error) {
    console.error("Error handling image request:", error.message);
    res.status(500).send("Internal server error.");
  }
}
