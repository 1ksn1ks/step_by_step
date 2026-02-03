import { helia, fs } from './helia.js'
import { CID } from 'multiformats/cid'
import { adjustTextareaHeight } from './adjusttextarea.js'

async function fetchContent() {
  const cidInput = document.getElementById('cid-input').value.trim()
  const output = document.getElementById('cid-output')

  if (!cidInput || !fs || !helia) {
    output.textContent = 'Check input or Helia initialization.'
    return
  }

  let cid
  try {
    cid = CID.parse(cidInput)
  } catch (err) {
    output.textContent = `Invalid CID: ${err.message}`
    return
  }

  try {
    output.textContent = `Searching on your Someguy server: ${cid.toString()} ...`
    adjustTextareaHeight(output)

    // 1. Finding providers via your Delegated Routing
    console.log(`Querying router for: ${cid}`)
    const providers = []
    for await (const provider of helia.routing.findProviders(cid)) {
      providers.push(provider.id)
      console.log('Found client that has the file:', provider.id.toString())
    }

    // 2. Fetching data directly via Helia FS (Bitswap)
    // We are not using verifiedFetch because it goes to public gateways, 
    // and you want your own P2P circle.
    const chunks = []
    for await (const chunk of fs.cat(cid)) {
      chunks.push(chunk)
    }
    const data = new Uint8Array(await new Blob(chunks).arrayBuffer())

    // 3. Displaying content
    output.textContent = `Successfully fetched: ${cid.toString()}`
    displayMedia(data)

    // 4. Pinning and ANNOUNCING to your Someguy server so this client now offers the file too
    await helia.pins.add(cid)
    
    // This is the key line: it sends an HTTP POST to your Fly.io server
    console.log('Announcing to your server that I possess this CID...')
    await helia.routing.provide(cid)
    
    console.log('Announcement successful!')
    output.textContent += '\n(File is now published on this node as well)'
    adjustTextareaHeight(output)

  } catch (err) {
    console.error('Fetch failed:', err)
    output.textContent = `Error: ${err.message}`
    adjustTextareaHeight(output)
  }
}

function displayMedia(data) {
  const contentType = document.getElementById('content-type')?.value || 'image'
  const container = document.getElementById('image-container') || document.body
  container.innerHTML = ''

  const mimeType = contentType === 'video' ? 'video/mp4' : 'image/jpeg'
  const blob = new Blob([data], { type: mimeType })
  const url = URL.createObjectURL(blob)

  const el = document.createElement(contentType === 'video' ? 'video' : 'img')
  if (contentType === 'video') el.controls = true
  el.src = url
  el.style.maxWidth = '100%'
  container.appendChild(el)
}

document.getElementById('fetch-from-ipfs-button').addEventListener('click', fetchContent)
