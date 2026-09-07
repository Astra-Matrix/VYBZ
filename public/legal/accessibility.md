# Accessibility Statement

Effective 2026-09-07. VYBZ wants everyone to be able to use vybz.cloud, the VYBZ console, and the documentation, whatever tools they use to browse.

## Standard

We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA across the public site, the console, and the documentation. The API and MCP server are text interfaces and are usable from any terminal or assistive environment.

## What we do

- Pages are built from semantic HTML: one heading hierarchy per page, landmarks for header, main, and footer, real buttons and links, and tables with header cells.
- Everything works with a keyboard. Focus is visible on every control, the tab order follows the reading order, and a skip link at the top of each page jumps to the main content.
- Colour contrast meets the AA ratios in both the light and dark appearance, and colour is never the only signal; status is always also stated in words.
- Every form control has a label, and errors are shown as text next to the control that caused them.
- Nothing flashes, and animation is turned off when your system asks for reduced motion.
- Drag-and-drop areas in the console also open a standard file picker, and icon-only buttons carry a text name for screen readers.
- No time limits are imposed on completing a task, and sessions do not expire while you are working.
- Text can be resized to 200 percent and the layout reflows without horizontal scrolling.
- On phones and tablets every control is at least 44 pixels tall, navigation is behind a clearly labelled menu button, and effects that need a mouse pointer are switched off.
- Long tables and code samples scroll inside their own frame, which can be reached and scrolled from the keyboard.

## Known limitations

- The checkout window is provided by Paddle, our payment provider, and we cannot change its markup. Paddle publishes its own accessibility information, and you can complete a subscription by email instead: billing@vybz.cloud.
- Some documentation pages contain long reference tables that are easier to read in landscape orientation on small screens.
- Audio itself is the subject of the product; where the console describes audio it uses text and numbers, never sound alone.

## Compatibility

Tested with current versions of Chrome, Firefox, Safari, and Edge, with VoiceOver on macOS and iOS, NVDA on Windows, and with keyboard-only navigation. The site requires JavaScript for the console; the public pages and documentation are prerendered and readable without it.

## Feedback

If anything is hard to use, tell us at accessibility@vybz.cloud and include the page address and the tools you were using. We reply within five business days and treat access barriers as bugs. This statement is reviewed whenever the interface changes and at least twice a year.
