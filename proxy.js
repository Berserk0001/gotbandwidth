import got from 'got';
import sharp from 'sharp';

// Constants
const DEFAULT_QUALITY = 80;
const MAX_HEIGHT = 16383; // Resize if height exceeds this value

// Utility function to determine if compression is needed
function shouldCompress(originType, originSize, isWebp) {
  const MIN_COMPRESS_LENGTH = isWebp ? 10000 : 50000;
  return (
    originType.startsWith("image") &&
    originSize >= MIN_COMPRESS_LENGTH &&
    !originType.endsWith("gif") // Skip GIFs for simplicity
  );
}
function redirect(res) {
  if (res.headersSent) {
    return;
  }

  res.setHeader('content-length', 0);
  res.removeHeader('cache-control');
  res.removeHeader('expires');
  res.removeHeader('date');
  res.removeHeader('etag');
  res.setHeader('location', encodeURI(imageUrl));
  res.status(302).end();
}
// Function to compress an image stream directly
function compressStream(input, format, quality, grayscale, res) {

  // Pipe the input stream to the sharp instance
  const sharpInstance = sharp({ unlimited: true, animated: false });

  const imagePipeline = input.pipe(sharpInstance);

  // Process the image
  imagePipeline
    .metadata()
    .then((metadata) => {
      // Resize if height exceeds the limit
      if (metadata.height > 16383) {
        sharpInstance.resize({ height: 16383 });
      }

      // Apply grayscale if requested
      if (grayscale) {
        sharpInstance.grayscale();
      }

      // Set preliminary response headers
      res.setHeader("Content-Type", `image/${format}`);
      res.setHeader("X-Original-Size", req.params.originSize || metadata.size);

      // Stream processed image to response
      sharpInstance
        .toFormat(format, {
          quality, // Set compression quality
          effort: 0, // Optimize for speed
        })
        .on("info", (info) => {
          // Set additional headers after processing starts
          const originalSize = parseInt(originSize, 10) || metadata.size || 0;
          const bytesSaved = originalSize - info.size;

          res.setHeader("X-Bytes-Saved", bytesSaved > 0 ? bytesSaved : 0);
          res.setHeader("X-Processed-Size", info.size);
        })
        .pipe(res)
        .on("error", (err) => {
          console.error("Error during image processing:", err.message);
          redirect(res); // Handle streaming errors
        });
    })
    .catch((err) => {
      console.error("Error fetching metadata:", err.message);
      redirect(res); // Handle metadata errors
    });
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
    const imageStream = got.stream(imageUrl);

    // Listen for the response event to check the headers
    imageStream.on('response', (response) => {
      const originType = response.headers['content-type'];
      const originSize = parseInt(response.headers['content-length'], 10) || 0;

      if (shouldCompress(originType, originSize, isWebp)) {
        // Apply compression directly to the stream using sharp
        compressStream(imageStream, format, quality, grayscale, res);

      } else {
        // If no compression needed, stream the image directly to the response
        res.setHeader('Content-Type', originType);
        res.setHeader('Content-Length', originSize);
        imageStream.pipe(res);
      }
    });

    // Handle stream errors
    imageStream.on('error', (error) => {
      console.error("Error fetching image:", error.message);
      res.status(500).send("Failed to fetch the image.");
    });

    // Handle the end event
    imageStream.on('end', () => {
      console.log('Image stream ended.');
    });

  } catch (error) {
    console.error("Error handling image request:", error.message);
    res.status(500).send("Internal server error.");
  }
}
