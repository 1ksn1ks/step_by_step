// fetch.js
import { helia, fs } from './helia.js'   // adjust path
import { CID } from 'multiformats/cid'
import { verifiedFetch } from '@helia/verified-fetch'
import { adjustTextareaHeight } from './adjusttextarea.js'

async function fetchContent() {
  const cidInput = document.getElementById('cid-input').value.trim()
  if (!cidInput) {
    alert('No CID provided')
    return
  }

  if (!fs || !helia) {
    document.getElementById('cid-output').textContent = 'Helia not initialized.'
    return
  }

  let cid
  try {
    cid = CID.parse(cidInput)
  } catch (err) {
    document.getElementById('cid-output').textContent = `Invalid CID: ${err.message}`
    return
  }

  const contentType = document.getElementById('content-type')?.value || 'image'

  try {
    document.getElementById('cid-output').textContent = `Fetching CID: ${cid.toString()} ...`
    adjustTextareaHeight(document.getElementById('cid-output'))

    // Optional: log providers (for debug)
    console.log(`Looking for providers of ${cid}`)
    const providers = []
    for await (const prov of helia.libp2p.services.dht.findProviders(cid)) {
      if (prov && prov.peer) {
        providers.push(prov.peer)
        console.log('Found provider peer:', prov.peer.toString())
      }
    }
    if (providers.length === 0) {
      console.warn('No direct p2p providers found – falling back to gateways / trustless HTTP')
    }

    // Preferred: use verifiedFetch (trustless + verified)
    const ipfsUrl = `ipfs://${cid.toString()}`
    console.log(`Fetching via verifiedFetch: ${ipfsUrl}`)
    const response = await verifiedFetch(ipfsUrl, { timeout: 60000 })  // adjust timeout

    if (!response.ok) {
      throw new Error(`verifiedFetch failed: HTTP ${response.status} ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const data = new Uint8Array(arrayBuffer)
    console.log('Fetched size:', data.length)

    // Display
    document.getElementById('cid-output').textContent = `Fetched successfully: ${cid.toString()}`
    adjustTextareaHeight(document.getElementById('cid-output'))

    let mimeType = contentType === 'video' ? 'video/mp4' : 'image/jpeg'  // improve detection if possible
    let displayElement

    if (contentType === 'video') {
      mimeType = 'video/mp4'  // or sniff from response.headers if available
      displayElement = document.createElement('video')
      displayElement.controls = true
      displayElement.style.maxWidth = '100%'
    } else {
      mimeType = 'image/jpeg'  // fallback; better: use file-type or magic bytes
      displayElement = document.createElement('img')
      displayElement.style.maxWidth = '100%'
    }

    const blob = new Blob([data], { type: mimeType })
    displayElement.src = URL.createObjectURL(blob)
    displayElement.alt = `${contentType} from IPFS`

    const container = document.getElementById('image-container') || document.body
    container.innerHTML = ''
    container.appendChild(displayElement)

    // Step 3: Pin + announce (become provider)
    await helia.pins.add(cid)

    let announced = false
    const maxRetries = 8
    let retryCount = 0

    while (!announced && retryCount < maxRetries) {
      try {
        console.log(`Providing/announcing CID (attempt ${retryCount + 1}/${maxRetries})`)
        const providePromise = helia.libp2p.services.dht.provide(cid)

        const timeoutMs = retryCount === 0 ? 30000 : Math.min(150000, 30000 * Math.pow(1.8, retryCount))
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Provide timeout after ${timeoutMs / 1000}s`)), timeoutMs)
        )

        await Promise.race([providePromise, timeout])
        console.log('Announced successfully')
        announced = true
      } catch (err) {
        console.error(`Provide attempt ${retryCount + 1} failed:`, err)
        retryCount++
        if (retryCount < maxRetries) {
          const backoff = 10000 * Math.pow(1.5, retryCount)  // softer backoff
          await new Promise(r => setTimeout(r, backoff))
        }
      }
    }

    if (!announced) {
      console.warn('Could not announce to DHT after retries – content is pinned locally')
      document.getElementById('cid-output').textContent += '\n(Note: Announcement to network failed – retry later if needed)'
    }

  } catch (err) {
    console.error('Fetch failed:', err)
    document.getElementById('cid-output').textContent = `Fetch failed: ${err.message || err}`
    adjustTextareaHeight(document.getElementById('cid-output'))
  }
}

// Attach listener (can be here or in main script)
document.getElementById('fetch-from-ipfs-button').addEventListener('click', fetchContent)