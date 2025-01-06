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

// Function to compress an image and pipe it to the response
function compressAndPipe(input, res, format, quality, grayscale) {
  const sharpInstance = sharp({ unlimited: true, animated: false });

  input.pipe(sharpInstance);

  sharpInstance
    .metadata()
    .then((metadata) => {
      if (metadata.height > MAX_HEIGHT) {
        sharpInstance.resize({ height: MAX_HEIGHT });
      }

      if (grayscale) {
        sharpInstance.grayscale();
      }

      res.setHeader("Content-Type", `image/${format}`);

      sharpInstance
        .toFormat(format, { quality })
        .on("info", (info) => {
          res.setHeader("Content-Length", info.size);
          res.setHeader("X-Processed-Size", info.size);
        })
        .pipe(res)
        .on("error", (err) => {
          console.error("Error during image processing:", err.message);
          res.status(500).send("Internal server error.");
        });
    })
    .catch((err) => {
      console.error("Error fetching metadata:", err.message);
      res.status(500).send("Internal server error.");
    });
}

// Function to handle image compression requests
export async function fetchImageAndHandle(req, res) {
  const imageUrl = req.query.url;
  const isWebp = !req.query.jpeg;
  const grayscale = req.query.bw == "1";
  const quality = parseInt(req.query.quality, 10) || DEFAULT_QUALITY;
  const format = isWebp ? "webp" : "jpeg";

  if (!imageUrl) {
    return res.status(400).send("Image URL is required.");
  }

  try {
    const stream = got.stream(imageUrl);

    stream.on('response', (response) => {
      const originType = response.headers["content-type"];
      const originSize = parseInt(response.headers["content-length"], 10) || 0;

      res.setHeader("X-Original-Size", originSize);

      if (shouldCompress(originType, originSize, isWebp)) {
        compressAndPipe(stream, res, format, quality, grayscale);
      } else {
        res.setHeader("Content-Type", originType);
        res.setHeader("Content-Length", originSize);
        stream.pipe(res);
      }
    });

    stream.on('error', (error) => {
      console.error("Error fetching image:", error.message);
      res.status(500).send("Internal server error.");
    });
  } catch (error) {
    console.error("Error handling image request:", error.message);
    res.status(500).send("Internal server error.");
  }
}
