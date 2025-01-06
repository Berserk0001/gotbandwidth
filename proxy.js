
import sharp from "sharp";

// Constants
const DEFAULT_QUALITY = 80;
const MIN_TRANSPARENT_COMPRESS_LENGTH = 50000;
const MIN_COMPRESS_LENGTH = 10000;

// Function to determine if compression is needed
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  if (!originType.startsWith("image")) return false;
  if (originSize === 0 || req.headers.range) return false;

  if (
    !webp &&
    (originType.endsWith("png") || originType.endsWith("gif")) &&
    originSize < MIN_TRANSPARENT_COMPRESS_LENGTH
  ) {
    return false;
  }

  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;

  return true;
}

// Function to compress the image
function compress(req, res, inputStream) {
  const format = req.params.webp ? "webp" : "jpeg";
  const sharpInstance = sharp({ unlimited: true, animated: false });

  inputStream
    .pipe(sharpInstance) // Pipe input stream to sharp instance
    .on('error', (err) => {
      console.error('Error during image processing:', err.message);
      res.statusCode = 500;
      res.end('Failed to process image.');
    });

  // Handle the metadata to perform necessary transformations
  sharpInstance
    .metadata()
    .then((metadata) => {
      if (metadata.height > 16383) {
        sharpInstance.resize({ height: 16383 });
      }

      if (req.params.grayscale) {
        sharpInstance.grayscale();
      }

      // Stream the processed image directly to the response
      sharpInstance
        .toFormat(format, { quality: req.params.quality })
        .pipe(res) // Pipe the processed image to the response stream
        .on('finish', () => {
          // Optionally, log success or handle post-pipe actions
          console.log('Image processing complete and sent to client.');
        })
        .on('error', (err) => {
          console.error('Error while streaming the image:', err.message);
          res.statusCode = 500;
          res.end('Failed to stream the image.');
        });
    })
    .catch((err) => {
      console.error('Error fetching metadata:', err.message);
      res.statusCode = 500;
      res.end('Failed to fetch image metadata.');
    });
}

// Function to handle the request
function handleRequest(req, res, origin) {
  if (shouldCompress(req)) {
    compress(req, res, origin.data);
  } else {
    res.setHeader("X-Proxy-Bypass", 1);

    ["accept-ranges", "content-type", "content-length", "content-range"].forEach((header) => {
      if (origin.headers[header]) {
        res.setHeader(header, origin.headers[header]);
      }
    });

    origin.data.pipe(res);
  }
}

import got from "got";

export function fetchImageAndHandle(req, res) {
  const url = req.query.url; // Extract URL from query
  if (!url) {
    return res.send("bandwidth-hero-proxy");
  }

  // Set request parameters
  req.params = {
    url: decodeURIComponent(url),
    webp: !req.query.jpeg,
    grayscale: req.query.bw != 0,
    quality: parseInt(req.query.l, 10) || DEFAULT_QUALITY,
  };

  // Use got.stream to fetch the image as a stream
  const stream = got.stream(req.params.url);

  // Handle response metadata
  stream.on("response", (response) => {
    if (response.statusCode >= 400) {
      res.statusCode = response.statusCode;
      return res.end("Failed to fetch the image.");
    }

    // Extract headers and set request parameters
    req.params.originType = response.headers["content-type"];
    req.params.originSize = parseInt(response.headers["content-length"], 10) || 0;

    const origin = {
      headers: response.headers,
      data: stream, // Pass the stream directly
    };

    // Process the request (e.g., compression or bypass)
    handleRequest(req, res, origin);
  });

  // Handle errors during the stream
  stream.on("error", (err) => {
    console.error("Error fetching image:", err.message);
    res.statusCode = 500;
    res.end("Failed to fetch the image.");
  });
}
