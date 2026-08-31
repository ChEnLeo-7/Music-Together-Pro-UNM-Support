import assert from 'node:assert/strict'
import { test } from 'node:test'
import { musicProvider } from './musicProvider.js'

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('Tencent song search falls back when the desktop endpoint rejects the request', async () => {
  const requests: string[] = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)

    if (url.includes('musicu.fcg')) {
      return jsonResponse({
        code: 0,
        'music.search.SearchCgiService.DoSearchForQQMusicDesktop': { code: 2001 },
      })
    }

    return jsonResponse({
      code: 0,
      data: {
        song: {
          list: [
            {
              songmid: '0039MnYb0qxYhV',
              songname: '晴天',
              singer: [{ name: '周杰伦' }],
              albummid: '000MkMni19ClKG',
              albumname: '叶惠美',
              interval: 269,
              pay: { paydownload: 1, paytrackmouth: 1 },
            },
          ],
        },
      },
    })
  }

  try {
    const tracks = await musicProvider.search('tencent', 'fallback-regression', 20, 1)

    assert.equal(requests.length, 2)
    assert.match(requests[1]!, /client_search_cp/)
    assert.equal(tracks.length, 1)
    assert.deepEqual(tracks[0]?.artist, ['周杰伦'])
    assert.equal(tracks[0]?.sourceId, '0039MnYb0qxYhV')
    assert.equal(tracks[0]?.title, '晴天')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Tencent search does not cache a temporary empty response', async () => {
  let requestCount = 0
  globalThis.fetch = async (input) => {
    requestCount += 1
    const url = String(input)

    if (url.includes('client_search_cp')) {
      return jsonResponse({ code: 0, data: { song: { list: [] } } })
    }

    const key = 'music.search.SearchCgiService.DoSearchForQQMusicDesktop'
    return jsonResponse(
      requestCount === 1
        ? { code: 0, [key]: { code: 2001 } }
        : {
            code: 0,
            [key]: {
              code: 0,
              data: {
                body: {
                  song: {
                    list: [
                      {
                        mid: '001Bbywq2gicae',
                        name: '搁浅',
                        singer: [{ name: '周杰伦' }],
                        album: { mid: '003DFRzD192KKD', name: '七里香' },
                        interval: 240,
                      },
                    ],
                  },
                },
              },
            },
          },
    )
  }

  try {
    const first = await musicProvider.search('tencent', 'empty-cache-regression', 20, 1)
    const second = await musicProvider.search('tencent', 'empty-cache-regression', 20, 1)

    assert.deepEqual(first, [])
    assert.equal(second.length, 1)
    assert.equal(second[0]?.title, '搁浅')
    assert.equal(requestCount, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})
