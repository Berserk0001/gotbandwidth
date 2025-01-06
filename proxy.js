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
    !originType.ends to("gif") // Skip GIFs for simplicity
  );
}

// Function to compress an image stream directly
function compressStream(inputStream, format, quality, grayscale) {
  const imagePipeline = sharp({ unlimited: true, animated: false });

  // Pipe input stream to sharp
  const sharpInstance = inputStream.pipe(imagePipeline);

  if (grayscale) {
    sharpInstance.grayscale();
  }

  // First, we get metadata to check the height for resizing
  sharpInstance.metadata().then(metadata => {
    if (metadata.height > MAX_HEIGHT) {
      sharpInstance.resize({ height: MAX_HEIGHT }); // Resize if height exceeds 16383
    }
  }).catch((error) => {
    console.error('Error getting metadata:', error.message);
  });

  // Set the output format based on the user's preference (jpeg or webp)
  if (format === "webp") {
    sharpInstance.toFormat("webp", { quality });
  } else {
    sharpInstance.toFormat("jpeg", { quality });
  }

  return sharpInstance;
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
        const compressedStream = compressStream(imageStream, format, quality, grayscale);

        // Set headers for the compressed image
        res.setHeader('Content-Type', `image/${format}`);
        res.setHeader('Content-Length', originSize); // The original size is still used in the response header
        res.setHeader('X-Original-Size', originSize);

        // Stream the compressed data directly to the response
        compressedStream.pipe(res);

        // Optionally, you can listen to 'info' to capture processed image size
        compressedStream.on('info', (info) => {
          res.setHeader('X-Processed-Size', info.size);
          res.setHeader('X-Bytes-Saved', originSize - info.size);
        });

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
