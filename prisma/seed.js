require("dotenv").config();

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const business = await prisma.business.upsert({
    where: { id: 1 },
    update: {
      name: "My AI PA Demo Business",
      phone: "+1-555-010-1000",
      timezone: "America/New_York",
    },
    create: {
      id: 1,
      name: "My AI PA Demo Business",
      phone: "+1-555-010-1000",
      timezone: "America/New_York",
    },
  });

  await prisma.settings.upsert({
    where: { businessId: business.id },
    update: {
      answerAfterRings: 3,
      afterHoursMode: "AI_ALWAYS_ON",
      ownerPhone: "+1-555-010-2000",
      bookingLink: "https://example.com/book",
    },
    create: {
      businessId: business.id,
      answerAfterRings: 3,
      afterHoursMode: "AI_ALWAYS_ON",
      ownerPhone: "+1-555-010-2000",
      bookingLink: "https://example.com/book",
    },
  });

  const faqs = [
    {
      question: "What are your business hours?",
      answer: "We answer calls 24/7 and dispatch according to your configured schedule.",
      tags: "hours,schedule",
    },
    {
      question: "Can I book an appointment?",
      answer: "Yes. We can capture details and route to your booking workflow.",
      tags: "booking,appointments",
    },
    {
      question: "Do you provide estimates?",
      answer: "Yes. Our AI assistant can collect job details and create a quote lead.",
      tags: "estimates,quote",
    },
  ];

  await prisma.fAQ.deleteMany({ where: { businessId: business.id } });

  for (const faq of faqs) {
    await prisma.fAQ.create({
      data: {
        businessId: business.id,
        question: faq.question,
        answer: faq.answer,
        tags: faq.tags,
      },
    });
  }

  console.log(`Seeded business ${business.id} with default settings and FAQs.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
