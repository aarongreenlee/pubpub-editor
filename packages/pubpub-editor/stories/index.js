import { HtmlDoc, ReferenceOrdering, SampleMarkdown, SingleMention, SingleReference, TableMarkdown } from './sampledocs';
import { LongLegacyBug, MentionContentBug } from './bugdata';

import CodeEditor from './storybookCodeEditor';
import FullEditor from './storybookFullEditor';
import MarkdownEditor from './storybookMarkdownEditor';
import React from 'react';
import RichEditor from './storybookRichEditor';
import { storiesOf } from '@kadira/storybook';

storiesOf('Rich Editor', module)
.add('basic ', () => (
	<RichEditor />
))
.add('single reference', () => (
	<RichEditor initialState={SingleReference} />
))
.add('single mention', () => (
	<RichEditor initialState={SingleMention} />
));

storiesOf('Code Editor', module)
.add('basic ', () => (
	<CodeEditor />
));

storiesOf('Markdown Editor', module)
.add('basic ', () => (
	<MarkdownEditor />
));

storiesOf('Full Editor', module)
.add('basic ', () => (
	<FullEditor />
))
.add('table conversion ', () => (
	<FullEditor mode={'markdown'} initialContent={TableMarkdown} />
))
.add('reference serializing ', () => (
	<FullEditor mode={'rich'} initialContent={SingleReference} />
))
.add('Full Markdown Test', () => (
	<FullEditor mode={'markdown'} initialContent={SampleMarkdown} />
))
.add('Reference Ordering Test', () => (
	<FullEditor mode={'markdown'} initialContent={ReferenceOrdering} />
))
.add('Html Test', () => (
	<FullEditor mode={'markdown'} initialContent={HtmlDoc} />
))
;

storiesOf('Debugging', module)
.add('mention content ', () => (
	<FullEditor mode={'markdown'} initialContent={MentionContentBug} />
))
.add('long legacy ', () => (
	<FullEditor mode={'rich'} initialContent={LongLegacyBug} />
))
;