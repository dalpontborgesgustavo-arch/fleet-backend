import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ChecklistConsentService } from './checklist-consent.service';
import { ChecklistService } from './checklist.service';

describe('ChecklistService assignment notification recipients', () => {
  const sendMail = jest.fn();
  const historyUpdate = jest.fn();
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Usuario Teste' }),
    },
    vehicleAssignmentHistory: { update: historyUpdate },
  };
  const service = new ChecklistService(
    prisma as unknown as PrismaService,
    {} as ChecklistConsentService,
    { sendMail } as unknown as EmailService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    sendMail.mockResolvedValue({ sent: true });
    historyUpdate.mockResolvedValue({});
  });

  it.each([
    ['primeiro cadastro', null, null],
    ['troca de vinculo', 'Operador anterior', 'Responsavel anterior'],
  ])(
    'sends %s only to the remaining recipient',
    async (_, previousDriverName, previousResponsibleName) => {
      await service['sendAssignmentNotification'](
        'checklist-1',
        {
          vehicleFleet: '67',
          vehiclePlate: 'PAT-2015',
          vehicleName: 'Mot niveladora',
          vehicleModel: null,
          previousDriverName,
          previousResponsibleName,
          checklistDriverName: 'Operador atual',
          currentDriverName: 'Operador atual',
          responsibleName: 'Responsavel atual',
          vehicleStopped: false,
          driverChanged: true,
          responsibleChanged: true,
        },
        'user-1',
      );

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'daniela.silva@jrmc.com.br' }),
      );
      expect(historyUpdate).toHaveBeenCalledTimes(1);
    },
  );
});
