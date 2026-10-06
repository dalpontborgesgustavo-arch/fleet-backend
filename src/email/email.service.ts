import { Injectable } from '@nestjs/common';
import nodemailer, { Transporter, type SendMailOptions } from 'nodemailer';

type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: NonNullable<SendMailOptions['attachments']>;
};

@Injectable()
export class EmailService {
  private transporter: Transporter | null = null;

  async sendMail(input: SendMailInput) {
    const transporter = this.getTransporter();

    if (!transporter) {
      console.warn(
        `[email] SMTP nao configurado. E-mail pendente para ${input.to}: ${input.subject}`,
      );
      return { sent: false, error: 'SMTP nao configurado.' };
    }

    try {
      await transporter.sendMail({
        from: this.getFromAddress(),
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments: input.attachments,
      });

      return { sent: true, error: null };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha desconhecida no envio.';
      console.warn(`[email] Falha ao enviar para ${input.to}: ${message}`);
      return { sent: false, error: message };
    }
  }

  private getTransporter() {
    if (this.transporter) {
      return this.transporter;
    }

    const host = process.env.SMTP_HOST?.trim();
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass || !Number.isFinite(port)) {
      return null;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      auth: { user, pass },
    });

    return this.transporter;
  }

  private getFromAddress() {
    return (
      process.env.SMTP_FROM?.trim() ||
      process.env.SMTP_USER?.trim() ||
      'Sistema JR <no-reply@jrconstrucoes.net.br>'
    );
  }
}
