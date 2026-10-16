import type { Attachment } from '@juno/slack-schema'

/** Invented link previews; every image is served by the fake. */
export function unfurlFixtures(base: string): Readonly<Record<'xImage' | 'xText' | 'failed' | 'youtube' | 'github' | 'docs' | 'generic', Attachment>> {
  const image = `${base}/avatars/U0MAYA.svg`
  const post = { service_name: 'X', service_icon: image, author_name: 'Avery Example (@avery_example)', author_icon: image, title: 'Avery Example on X', from_url: 'https://example.test/post/1', text: 'Small experiments make the next decision clearer.', footer: 'X', ts: 1792141200 }
  return {
    xImage: { ...post, image_url: image, image_width: 600, image_height: 400 },
    xText: { ...post, text: 'A text-only update from the test workspace.' },
    failed: { title: 'Unavailable preview image', text: 'The description remains readable.', image_url: `${base}/avatars/missing.svg`, image_width: 1200, image_height: 630, service_name: 'Example' },
    youtube: { service_name: 'YouTube', service_icon: image, author_name: 'Example Studio', title: 'How the demo works', title_link: 'https://example.test/watch/demo', text: 'A short tour of the prototype.', thumb_url: image, image_width: 640, image_height: 360 },
    github: { service_name: 'GitHub', title: 'sample/project', text: 'A small demonstration project.', from_url: 'https://example.test/sample/project', thumb_url: image },
    docs: { service_name: 'Google Docs', title: 'Planning notes', text: 'Decisions for the next iteration.', from_url: 'https://example.test/document/1', service_icon: image },
    generic: { service_name: 'Example Journal', title: 'A useful observation', text: 'The summary supplied by the page.', from_url: 'https://example.test/article/1', image_url: image, image_width: 800, image_height: 420 },
  }
}
