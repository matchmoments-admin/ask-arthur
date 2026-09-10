import { Html, Head, Preview, Body, Container, Section, Heading, Text, Link, Button, Hr } from "@react-email/components";
import { safeProse, type NewsletterContent } from "@/lib/newsletter/content";

export default function ArthursWatch({ content, unsubscribeUrl = "https://askarthur.au/unsubscribe" }: { content: NewsletterContent; unsubscribeUrl?: string }) {
  return <Html lang="en"><Head /><Preview>{safeProse(content.preheader)}</Preview>
    <Body style={{ backgroundColor: "#f1f5f9", fontFamily: "Arial, sans-serif", color: "#1B2A4A", margin: 0 }}>
      <Container style={{ maxWidth: 600, backgroundColor: "#ffffff", padding: "28px 24px" }}>
        <Text style={{ fontSize: 13, letterSpacing: 2 }}>ASK ARTHUR</Text>
        <Heading style={{ fontFamily: "Georgia, serif", fontSize: 32 }}>Arthur’s Watch</Heading>
        <Text style={{ fontSize: 17, lineHeight: "26px" }}>A few minutes to spot the traps and know what to do.</Text>
        {content.stories.map((story, index) => <Section key={story.id}>
          <Hr style={{ borderColor: "#e2e8f0", margin: "28px 0" }} />
          <Text style={{ fontSize: 12, letterSpacing: 1 }}>{index === 0 ? "THIS WEEK’S MAIN WARNING" : "ALSO ON OUR RADAR"}</Text>
          <Heading as="h2" style={{ fontFamily: "Georgia, serif", fontSize: 25 }}>{safeProse(story.title)}</Heading>
          <Text style={{ fontSize: 16, lineHeight: "25px" }}>{safeProse(story.summary)}</Text>
          <Text style={{ fontSize: 13 }}>{safeProse(story.jurisdiction)} · Source dated {story.sourceDate.slice(0, 10)}</Text>
          <Section style={{ backgroundColor: "#f8fafc", padding: "12px 18px", borderLeft: "3px solid #1B2A4A" }}>
            <Heading as="h3" style={{ fontSize: 18 }}>Arthur’s Take</Heading>
            <Text style={{ fontSize: 16, lineHeight: "25px" }}>{safeProse(story.take)}</Text>
            <Text><strong>Spot it</strong></Text>
            {story.tells.map((tell, i) => <Text key={i} style={{ fontSize: 16, lineHeight: "24px" }}>• {safeProse(tell)}</Text>)}
            <Text style={{ fontSize: 16, lineHeight: "25px" }}><strong>What to do:</strong> {safeProse(story.action)}</Text>
          </Section>
          <Text><Link href={story.sourceUrl} style={{ color: "#1B2A4A", textDecoration: "underline" }}>Read the source: {safeProse(story.sourceLabel)}</Link></Text>
        </Section>)}
        <Hr style={{ margin: "28px 0" }} />
        <Heading as="h2" style={{ fontSize: 22 }}>Something doesn’t feel right?</Heading>
        <Button href="https://askarthur.au/?utm_source=email&utm_medium=newsletter&utm_campaign=arthurs-watch" style={{ backgroundColor: "#1B2A4A", color: "#fff", padding: "16px 20px", borderRadius: 4 }}>Check with Ask Arthur</Button>
        <Text style={{ fontSize: 13, lineHeight: "20px" }}>You’re receiving this because you subscribed to Ask Arthur. <Link href={unsubscribeUrl}>Unsubscribe</Link></Text>
        <Text style={{ fontSize: 12 }}>Ask Arthur · ABN 72 695 772 313 · Sydney, Australia</Text>
      </Container>
    </Body>
  </Html>;
}
