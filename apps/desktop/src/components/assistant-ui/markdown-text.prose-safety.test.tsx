import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MarkdownTextContent } from './markdown-text'

// Render-level regression for the prose-safety preprocessor fixes that landed
// on 2026-08-22 (upstream #50871 lone-tilde strikethrough, #53953 unknown
// html-like tokens swallowing the message tail). The preprocessor unit tests
// in markdown-text.test.ts assert on the transformed string; these mount the
// REAL production component and assert on the rendered DOM, so a wrapper that
// stopped applying the preprocess cannot pass here.
afterEach(cleanup)

describe('markdown prose renders tilde ranges and unknown tags literally', () => {
  it.each([
    [
      'CJK range list',
      '分组：奇数 1~10,11~20，其余另列。',
      (text: string) => {
        expect(text).toContain('1~10,11~20')
      }
    ],
    [
      'approximation prefixes in one paragraph',
      '收益为 3~5 倍，成本约 ~¥0.089。',
      (text: string) => {
        expect(text).toContain('3~5')
        expect(text).toContain('~¥0.089')
      }
    ]
  ])('renders %s without a strikethrough element', (_label, source, assertText) => {
    const { container } = render(<MarkdownTextContent isRunning={false} text={source} />)

    expect(container.querySelectorAll('del, s').length, `no strikethrough for: ${source}`).toBe(0)
    assertText(container.textContent || '')
  })

  it('renders unknown html-like tokens as literal text and keeps the tail visible', () => {
    const text =
      'The proxy wraps calls in <tool_call> and results in <observation> blocks. ' +
      'Keep the rest visible after the tag. The message tail must NOT vanish.'

    const { container } = render(<MarkdownTextContent isRunning={false} text={text} />)

    expect(container.textContent).toContain('<tool_call>')
    expect(container.textContent).toContain('<observation>')
    expect(container.textContent).toContain('The message tail must NOT vanish.')
    expect(container.querySelector('tool_call')).toBeNull()
    expect(container.querySelector('observation')).toBeNull()
  })

  it('leaves math comparisons untouched', () => {
    const { container } = render(<MarkdownTextContent isRunning={false} text={'如果 a < b 且 2<3 则原样保留。'} />)

    expect(container.textContent).toContain('a < b')
    expect(container.textContent).toContain('2<3')
  })

  const url = 'https://example.com/~alice/report~draft'

  it.each([url, `<${url}>`, `[Report](${url})`])(
    'preserves the full URL while streaming and after completion: %s',
    text => {
      const { container, rerender } = render(<MarkdownTextContent isRunning={true} text={text} />)

      expect(container.querySelector('a')?.getAttribute('href')).toBe(url)

      rerender(<MarkdownTextContent isRunning={false} text={text} />)

      expect(container.querySelector('a')?.getAttribute('href')).toBe(url)
    }
  )

  it('still renders intentional ~~strikethrough~~', () => {
    const { container, rerender } = render(<MarkdownTextContent isRunning={true} text={'保留 ~~deleted'} />)

    expect(container.querySelector('del, s')?.textContent).toBe('deleted')

    rerender(<MarkdownTextContent isRunning={false} text={'保留 ~~deleted~~ 删除线。'} />)

    expect(container.querySelectorAll('del, s').length).toBeGreaterThan(0)
    expect(container.textContent).toContain('deleted')
  })
})
