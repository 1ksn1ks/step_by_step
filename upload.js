// upload.js
import { helia, fs } from './helia.js'   // adjust path if in different folder, e.g. '../helia-init.js'
import { adjustTextareaHeight } from './adjusttextarea.js'

async function upload() {
  const fileInput = document.getElementById('fileInput')
  const file = fileInput.files[0]

  if (!file) {
    alert('No file selected')
    return
  }

  if (!fs || !helia) {
    document.getElementById('cid-output').textContent = 'Helia not initialized yet.'
    return
  }

  try {
    const fileArrayBuffer = await file.arrayBuffer()
    const fileBytes = new Uint8Array(fileArrayBuffer)
    console.log('File size:', fileBytes.length)

    const cid = await fs.addBytes(fileBytes)
    console.log('Added locally, CID:', cid.toString())

    document.getElementById('cid-output').textContent =
      'Waiting for network propagation (usually a few minutes). Retry after 5 min if no update.'
    adjustTextareaHeight(document.getElementById('cid-output'))

    await helia.pins.add(cid)

    let announced = false
    const maxRetries = 10
    let retryCount = 0
    const baseTimeout = 150_000 // 2.5 minutes

    while (!announced && retryCount < maxRetries) {
      try {
        console.log(`DHT provide attempt ${retryCount + 1}/${maxRetries}`)
        const announcePromise = helia.libp2p.services.dht.provide(cid)

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`DHT provide timeout after ${baseTimeout / 1000}s`)), baseTimeout)
        )

        await Promise.race([announcePromise, timeoutPromise])
        console.log('DHT announcement successful')
        announced = true
      } catch (err) {
        console.error(`Attempt ${retryCount + 1} failed:`, err)
        retryCount++
        if (retryCount < maxRetries) {
          const backoff = Math.pow(2, retryCount) * 5000
          console.log(`Retry in ${backoff / 1000}s...`)
          await new Promise(r => setTimeout(r, backoff))
        }
      }
    }

    if (announced) {
      const multiaddrs = helia.libp2p.getMultiaddrs()
      console.log('Announced from multiaddrs:', multiaddrs.map(m => m.toString()))
      document.getElementById('cid-output').textContent = `Upload successful!\nCID: ${cid.toString()}`
    } else {
      document.getElementById('cid-output').textContent =
        'Network announcement failed after retries.\nFile is pinned locally – try again later or check peers.'
    }

    adjustTextareaHeight(document.getElementById('cid-output'))
  } catch (err) {
    console.error('Upload error:', err)
    document.getElementById('cid-output').textContent = `Failed: ${err.message || err}`
    adjustTextareaHeight(document.getElementById('cid-output'))
  }
}

document.getElementById('upload-to-ipfs-button').addEventListener('click', upload)