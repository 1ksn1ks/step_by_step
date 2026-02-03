import { helia, fs } from './helia.js'
import { adjustTextareaHeight } from './adjusttextarea.js'

async function upload() {
  const fileInput = document.getElementById('fileInput')
  const file = fileInput.files[0]
  const output = document.getElementById('cid-output')

  if (!file) {
    alert('Please select a file!')
    return
  }

  if (!fs || !helia) {
    output.textContent = 'Helia client is not ready yet.'
    return
  }

  try {
    const fileBytes = new Uint8Array(await file.arrayBuffer())
    
    // 1. Adding the file to local Helia storage
    output.textContent = 'Adding file locally...'
    const cid = await fs.addBytes(fileBytes)
    
    // 2. Pinning (saving so it doesn't get garbage collected)
    await helia.pins.add(cid)
    
    console.log('Local CID:', cid.toString())
    output.textContent = `File added! CID: ${cid.toString()}\nSending notification to server...`
    adjustTextareaHeight(output)

    // 3. Announcing to your Someguy server on Fly.io
    // This replaces all those heavy DHT loops that took 2.5 minutes
    try {
      // This uses the Delegated Routing V1 HTTP API
      await helia.routing.provide(cid)
      console.log('Server received the file location.')
      output.textContent = `Upload successful!\n\nCID: ${cid.toString()}\n\nOther clients can now find this file via your routing server.`
    } catch (routeErr) {
      console.error('Routing error:', routeErr)
      output.textContent = `File is ready locally, but notifying the server failed: ${routeErr.message}`
    }

    adjustTextareaHeight(output)
  } catch (err) {
    console.error('Upload error:', err)
    output.textContent = `Error: ${err.message || err}`
    adjustTextareaHeight(output)
  }
}

document.getElementById('upload-to-ipfs-button').addEventListener('click', upload)
