import { Html, Head, Preview, Body, Container, Heading, Text, Button, Link } from "@react-email/components";

interface Props { confirmationUrl: string; unsubscribeUrl: string }

export default function NewsletterConfirmation({ confirmationUrl, unsubscribeUrl }: Props) {
  return (
    <Html lang="en">
      <Head />
      <Preview>One quick confirmation before your free weekly scam update.</Preview>
      <Body style={{ backgroundColor: "#F8FAFC", fontFamily: "Arial, sans-serif", color: "#42526E" }}>
        <Container style={{ maxWidth: "560px", padding: "32px 24px", backgroundColor: "#FFFFFF" }}>
          <Text style={{ color: "#001F3F", fontWeight: 700 }}>ASK ARTHUR</Text>
          <Heading as="h1" style={{ color: "#001F3F", fontSize: "26px" }}>Welcome to Arthur&apos;s Watch</Heading>
          <Text style={{ fontSize: "17px", lineHeight: "1.6" }}>
            One free email each week to help you recognise scams and take a practical next step.
            Confirm this is your address to start receiving it.
          </Text>
          <Button href={confirmationUrl} style={{ backgroundColor: "#001F3F", color: "#FFFFFF", padding: "14px 20px", borderRadius: "4px" }}>
            Confirm my email
          </Button>
          <Text style={{ fontSize: "15px", lineHeight: "1.6" }}>
            The link expires in 24 hours. You&apos;ll be asked to confirm on our website.
            If you didn&apos;t request this email, you can ignore it. This request won&apos;t subscribe you.
          </Text>
          <Text style={{ fontSize: "15px" }}>
            Already have a suspicious message? <Link href="https://askarthur.au">Check it free with Ask Arthur.</Link>
          </Text>
          <Text style={{ fontSize: "13px" }}>
            <Link href={unsubscribeUrl}>Stop these emails</Link><br />
            Ask Arthur | ABN 72 695 772 313 | Sydney, Australia
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
