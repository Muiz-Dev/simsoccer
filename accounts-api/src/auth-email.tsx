import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Text } from 'react-email';

export type AuthEmailProps = {
  title: string;
  preheader: string;
  message: string;
  code?: string;
};

export function AuthEmail({ title, preheader, message, code }: AuthEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preheader}</Preview>
      <Body style={{ margin: 0, backgroundColor: '#f3f5f1', color: '#1e2621', fontFamily: 'Arial, sans-serif' }}>
        <Container style={{ maxWidth: '480px', margin: '32px auto', padding: '28px', backgroundColor: '#ffffff', borderTop: '3px solid #0b442e' }}>
          <Text style={{ margin: '0 0 22px', color: '#0b442e', fontSize: '14px', fontWeight: 700 }}>SimSoccer</Text>
          <Heading as="h1" style={{ margin: '0 0 12px', fontSize: '22px', lineHeight: '1.3', fontWeight: 700 }}>{title}</Heading>
          <Text style={{ margin: '0', color: '#526057', fontSize: '15px', lineHeight: '1.6' }}>{message}</Text>
          {code ? (
            <Text style={{ margin: '24px 0', padding: '14px', backgroundColor: '#f3f5f1', color: '#0b442e', fontSize: '30px', fontWeight: 700, letterSpacing: '6px', textAlign: 'center' }}>
              {code}
            </Text>
          ) : null}
          <Hr style={{ margin: '24px 0', borderColor: '#d9dfda' }} />
          <Text style={{ margin: 0, color: '#6c766f', fontSize: '12px', lineHeight: '1.5' }}>
            This message was sent because an account action was requested. Never share a verification code.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}