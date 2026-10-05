import { Body, Container, Head, Heading, Html, Preview, Text } from 'react-email';

export type AuthEmailProps = {
  title: string;
  preheader: string;
  message: string;
  code?: string;
  securityNote?: string;
};

export function AuthEmail({ title, preheader, message, code, securityNote }: AuthEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preheader}</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: '#ffffff', color: '#18231d', fontFamily: 'Arial, Helvetica, sans-serif', textAlign: 'center' }}>
        <Container style={{ width: '100%', maxWidth: '520px', margin: '0 auto', padding: '40px 24px 32px', textAlign: 'center' }}>
          <Text style={{ margin: '0 0 28px', color: '#0b442e', fontSize: '13px', lineHeight: '1.4', fontWeight: 600, textAlign: 'center' }}>SimSoccer</Text>
          <Heading as="h1" style={{ margin: '0 0 12px', color: '#18231d', fontSize: '21px', lineHeight: '1.35', fontWeight: 600, textAlign: 'center' }}>{title}</Heading>
          <Text style={{ margin: 0, color: '#39483f', fontSize: '15px', lineHeight: '1.6', fontWeight: 400, textAlign: 'center' }}>{message}</Text>
          {code ? (
            <Text style={{ margin: '24px 0', color: '#0b442e', fontSize: '28px', lineHeight: '1.35', fontWeight: 600, letterSpacing: '4px', textAlign: 'center' }}>
              {code}
            </Text>
          ) : null}
          {securityNote ? (
            <Text style={{ margin: '24px 0 0', color: '#526057', fontSize: '13px', lineHeight: '1.55', fontWeight: 400, textAlign: 'center' }}>
              {securityNote}
            </Text>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}