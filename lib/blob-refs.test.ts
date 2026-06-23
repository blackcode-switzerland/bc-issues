import { describe, it, expect } from 'vitest'
import { extractUploadedUrls } from './blob-refs'

const BLOB = 'https://abc123.public.blob.vercel-storage.com'

describe('extractUploadedUrls', () => {
  it('finds an uploaded url in a markdown image', () => {
    expect(extractUploadedUrls(`![pic](${BLOB}/1-pic.png)`)).toEqual([`${BLOB}/1-pic.png`])
  })

  it('finds an uploaded url in an html <img> and <a>', () => {
    const html = `<p><img src="${BLOB}/1-a.png"><a href="${BLOB}/2-b.pdf">b</a></p>`
    expect(extractUploadedUrls(html).sort()).toEqual([`${BLOB}/1-a.png`, `${BLOB}/2-b.pdf`])
  })

  it('finds the url inside a file-attachment node', () => {
    const node = `<div data-type="file-attachment" data-file-url="${BLOB}/1-clip.mp4" data-filename="clip.mp4"></div>`
    expect(extractUploadedUrls(node)).toEqual([`${BLOB}/1-clip.mp4`])
  })

  it('handles local /uploads paths', () => {
    expect(extractUploadedUrls('<img src="/uploads/1-doc-ab12cd34.pdf">')).toEqual(['/uploads/1-doc-ab12cd34.pdf'])
  })

  it('keeps filenames containing underscores intact', () => {
    const url = `${BLOB}/1-my_file_name-ab12.png`
    expect(extractUploadedUrls(`![](${url})`)).toEqual([url])
  })

  it('dedupes a url that appears more than once', () => {
    const url = `${BLOB}/1-pic.png`
    expect(extractUploadedUrls(`![](${url}) and again ![](${url})`)).toEqual([url])
  })

  it('ignores external urls', () => {
    expect(extractUploadedUrls('<a href="https://example.com/x.pdf">x</a>')).toEqual([])
  })

  it('returns [] for null / undefined / empty', () => {
    expect(extractUploadedUrls(null)).toEqual([])
    expect(extractUploadedUrls(undefined)).toEqual([])
    expect(extractUploadedUrls('')).toEqual([])
  })

  it('strips trailing prose punctuation from a bare url', () => {
    expect(extractUploadedUrls(`see ${BLOB}/1-a.png.`)).toEqual([`${BLOB}/1-a.png`])
  })
})
