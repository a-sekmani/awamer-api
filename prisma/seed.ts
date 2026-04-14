import {
  PrismaClient,
  CertificateType,
  CourseEnrollmentStatus,
  CourseLevel,
  EnrollmentStatus,
  LessonType,
  MarketingOwnerType,
  PathStatus,
  CourseStatus,
  ProgressStatus,
  TestimonialStatus,
  TagStatus,
  CategoryStatus,
  BillingCycle,
} from '@prisma/client';

const prisma = new PrismaClient();

// Stable fixture IDs — make test assertions easy and enable idempotent cleanup.
const FIXTURE = {
  categories: {
    ai: 'seed-cat-ai',
    software: 'seed-cat-software',
  },
  tags: {
    ai: 'seed-tag-ai',
    productDev: 'seed-tag-product-dev',
    ux: 'seed-tag-ux',
    cybersecurity: 'seed-tag-cybersecurity',
    ml: 'seed-tag-ml',
  },
  plans: {
    free: 'seed-plan-free',
    monthly: 'seed-plan-monthly',
    quarterly: 'seed-plan-quarterly',
    yearly: 'seed-plan-yearly',
  },
  path: 'seed-path-1',
  coursesInPath: {
    c1: 'seed-course-1',
    c2: 'seed-course-2',
  },
  standaloneCourse: 'seed-course-standalone-1',
  users: {
    u1: 'seed-user-1',
    u2: 'seed-user-2',
  },
} as const;

// Deterministic bcrypt hash (placeholder — not used for login in seed data).
const PLACEHOLDER_PASSWORD_HASH =
  '$2a$10$abcdefghijklmnopqrstuuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV';

async function cleanup(): Promise<void> {
  const ownerIds = [
    FIXTURE.path,
    FIXTURE.coursesInPath.c1,
    FIXTURE.coursesInPath.c2,
    FIXTURE.standaloneCourse,
  ];

  // Polymorphic marketing content is not FK-linked, delete explicitly.
  await prisma.feature.deleteMany({ where: { ownerId: { in: ownerIds } } });
  await prisma.faq.deleteMany({ where: { ownerId: { in: ownerIds } } });
  await prisma.testimonial.deleteMany({ where: { ownerId: { in: ownerIds } } });

  // Users cascade to enrollments / progress / certificates / last positions.
  await prisma.user.deleteMany({
    where: { id: { in: Object.values(FIXTURE.users) } },
  });

  // Standalone course cascades to its tags pivot and content.
  await prisma.course.deleteMany({ where: { id: FIXTURE.standaloneCourse } });

  // Path cascades to courses (and their sections/lessons) and path_tags.
  await prisma.path.deleteMany({ where: { id: FIXTURE.path } });

  await prisma.tag.deleteMany({
    where: { id: { in: Object.values(FIXTURE.tags) } },
  });

  await prisma.category.deleteMany({
    where: { id: { in: Object.values(FIXTURE.categories) } },
  });

  await prisma.subscriptionPlan.deleteMany({
    where: { id: { in: Object.values(FIXTURE.plans) } },
  });
}

async function seedCategories(): Promise<void> {
  await prisma.category.createMany({
    data: [
      {
        id: FIXTURE.categories.ai,
        name: 'الذكاء الاصطناعي',
        slug: 'ai',
        description: 'مسارات في الذكاء الاصطناعي وتعلم الآلة',
        order: 1,
        status: CategoryStatus.ACTIVE,
      },
      {
        id: FIXTURE.categories.software,
        name: 'تطوير البرمجيات',
        slug: 'software-development',
        description: 'مسارات في هندسة البرمجيات',
        order: 2,
        status: CategoryStatus.ACTIVE,
      },
    ],
  });
}

async function seedTags(): Promise<void> {
  await prisma.tag.createMany({
    data: [
      { id: FIXTURE.tags.ai, name: 'ذكاء صناعي', slug: 'ai', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.productDev, name: 'تطوير منتجات', slug: 'product-dev', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.ux, name: 'تجربة مستخدم', slug: 'ux', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.cybersecurity, name: 'أمن سيبراني', slug: 'cybersecurity', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.ml, name: 'تعلم آلي', slug: 'ml', status: TagStatus.ACTIVE },
    ],
  });
}

async function seedPlans(): Promise<void> {
  await prisma.subscriptionPlan.createMany({
    data: [
      {
        id: FIXTURE.plans.free,
        name: 'Free',
        billingCycle: BillingCycle.FREE,
        price: 0,
        durationDays: 0,
        isDefault: true,
      },
      {
        id: FIXTURE.plans.monthly,
        name: 'Monthly',
        billingCycle: BillingCycle.MONTHLY,
        price: 19,
        durationDays: 30,
      },
      {
        id: FIXTURE.plans.quarterly,
        name: 'Quarterly',
        billingCycle: BillingCycle.QUARTERLY,
        price: 49,
        durationDays: 90,
      },
      {
        id: FIXTURE.plans.yearly,
        name: 'Yearly',
        billingCycle: BillingCycle.YEARLY,
        price: 159,
        durationDays: 365,
      },
    ],
  });
}

async function seedPathWithContent(): Promise<{ lessonIds: string[] }> {
  await prisma.path.create({
    data: {
      id: FIXTURE.path,
      categoryId: FIXTURE.categories.ai,
      title: 'مسار مهندس الذكاء الاصطناعي',
      slug: 'ai-engineer',
      subtitle: 'ابنِ مسيرتك المهنية في الذكاء الاصطناعي',
      description: 'مسار شامل يغطي أساسيات ML وتطوير نماذج الإنتاج',
      level: 'intermediate',
      thumbnail: 'https://placehold.co/600x400?text=AI',
      promoVideoUrl: 'https://example.com/promo-ai.mp4',
      promoVideoThumbnail: 'https://placehold.co/600x400?text=promo',
      estimatedHours: 40,
      isNew: true,
      skills: ['بايثون', 'تعلم آلي', 'شبكات عصبية', 'معالجة لغات طبيعية'],
      isFree: false,
      status: PathStatus.PUBLISHED,
      order: 1,
      tags: {
        create: [
          { tagId: FIXTURE.tags.ai },
          { tagId: FIXTURE.tags.ml },
          { tagId: FIXTURE.tags.productDev },
        ],
      },
    },
  });

  // Path marketing content (polymorphic)
  await prisma.feature.createMany({
    data: [
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, icon: 'sparkles', title: 'مشاريع حقيقية', description: 'تدرّب على مشاريع من الصناعة', order: 1 },
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, icon: 'users', title: 'مجتمع نشط', description: 'تفاعل مع المتعلمين', order: 2 },
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, icon: 'certificate', title: 'شهادة معتمدة', description: 'احصل على شهادة عند الإتمام', order: 3 },
    ],
  });
  await prisma.faq.createMany({
    data: [
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, question: 'كم يستغرق المسار؟', answer: 'حوالي 40 ساعة', order: 1 },
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, question: 'هل أحتاج خلفية برمجية؟', answer: 'نعم، أساسيات بايثون', order: 2 },
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, question: 'هل هناك شهادة؟', answer: 'نعم، شهادة إتمام المسار', order: 3 },
    ],
  });
  await prisma.testimonial.createMany({
    data: [
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, authorName: 'أحمد محمد', authorTitle: 'مهندس ML', content: 'محتوى ممتاز وتطبيقي', rating: 5, status: TestimonialStatus.APPROVED, order: 1 },
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, authorName: 'سارة علي', authorTitle: 'باحثة', content: 'بانتظار المراجعة', rating: 4, status: TestimonialStatus.PENDING, order: 2 },
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, authorName: 'خالد يوسف', authorTitle: 'مطور', content: 'مخفي من العرض', rating: 3, status: TestimonialStatus.HIDDEN, order: 3 },
    ],
  });

  // Courses inside the path (2), each with 2 sections, each with 2 lessons.
  const lessonIds: string[] = [];
  const coursesInPath = [
    { id: FIXTURE.coursesInPath.c1, slug: 'ml-foundations', title: 'أساسيات تعلم الآلة', order: 1 },
    { id: FIXTURE.coursesInPath.c2, slug: 'deep-learning', title: 'التعلم العميق', order: 2 },
  ];

  for (const c of coursesInPath) {
    await prisma.course.create({
      data: {
        id: c.id,
        categoryId: FIXTURE.categories.ai,
        pathId: FIXTURE.path,
        slug: c.slug,
        title: c.title,
        subtitle: `${c.title} — مقدمة`,
        description: `وصف ${c.title}`,
        level: CourseLevel.BEGINNER,
        thumbnail: 'https://placehold.co/600x400',
        isNew: false,
        skills: ['skill-a', 'skill-b'],
        order: c.order,
        isFree: false,
        status: CourseStatus.PUBLISHED,
        sections: {
          create: [
            {
              title: `${c.title} - قسم 1`,
              description: 'وصف القسم الأول',
              order: 1,
              lessons: {
                create: [
                  { title: 'درس 1', type: LessonType.TEXT, order: 1, isFree: true, estimatedMinutes: 10 },
                  { title: 'درس 2', type: LessonType.VIDEO, order: 2, isFree: false, estimatedMinutes: 15 },
                ],
              },
            },
            {
              title: `${c.title} - قسم 2`,
              description: 'وصف القسم الثاني',
              order: 2,
              lessons: {
                create: [
                  { title: 'درس 3', type: LessonType.TEXT, order: 1, isFree: false, estimatedMinutes: 10 },
                  { title: 'درس 4', type: LessonType.INTERACTIVE, order: 2, isFree: false, estimatedMinutes: 20 },
                ],
              },
            },
          ],
        },
      },
    });

    const sections = await prisma.section.findMany({
      where: { courseId: c.id },
      include: { lessons: true },
      orderBy: { order: 'asc' },
    });
    for (const s of sections) {
      for (const l of s.lessons) {
        lessonIds.push(l.id);
      }
    }
  }

  return { lessonIds };
}

async function seedStandaloneCourse(): Promise<{ standaloneLessonIds: string[] }> {
  await prisma.course.create({
    data: {
      id: FIXTURE.standaloneCourse,
      categoryId: FIXTURE.categories.software,
      pathId: null,
      order: null,
      slug: 'intro-to-cybersecurity',
      title: 'مقدمة في الأمن السيبراني',
      subtitle: 'دورة مستقلة في أساسيات الأمن',
      description: 'كورس قصير حول مبادئ الأمن السيبراني',
      level: CourseLevel.INTERMEDIATE,
      thumbnail: 'https://placehold.co/600x400?text=sec',
      isNew: true,
      skills: ['شبكات', 'تشفير', 'اختبار الاختراق'],
      isFree: false,
      status: CourseStatus.PUBLISHED,
      tags: {
        create: [
          { tagId: FIXTURE.tags.cybersecurity },
          { tagId: FIXTURE.tags.productDev },
        ],
      },
      sections: {
        create: [
          {
            title: 'مقدمة',
            description: 'نظرة عامة',
            order: 1,
            lessons: {
              create: [
                { title: 'أساسيات الشبكات', type: LessonType.TEXT, order: 1, isFree: true, estimatedMinutes: 10 },
                { title: 'مبادئ التشفير', type: LessonType.VIDEO, order: 2, isFree: false, estimatedMinutes: 20 },
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.feature.createMany({
    data: [
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, icon: 'shield', title: 'محتوى مركز', description: 'دورة قصيرة مكثفة', order: 1 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, icon: 'lock', title: 'ورش عملية', description: 'تمارين تطبيقية', order: 2 },
    ],
  });
  await prisma.faq.createMany({
    data: [
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, question: 'كم مدة الدورة؟', answer: 'ساعتان تقريبًا', order: 1 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, question: 'هل تحتاج برمجة؟', answer: 'لا، مقدمة عامة', order: 2 },
    ],
  });
  await prisma.testimonial.createMany({
    data: [
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, authorName: 'ليلى', authorTitle: 'طالبة', content: 'مفيدة جدًا', rating: 5, status: TestimonialStatus.APPROVED, order: 1 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, authorName: 'عمر', authorTitle: 'مهندس', content: 'قيد المراجعة', rating: 4, status: TestimonialStatus.PENDING, order: 2 },
    ],
  });

  const lessons = await prisma.lesson.findMany({
    where: { section: { courseId: FIXTURE.standaloneCourse } },
    orderBy: { order: 'asc' },
  });
  return { standaloneLessonIds: lessons.map((l) => l.id) };
}

async function seedUsers(
  pathLessonIds: string[],
  standaloneLessonIds: string[],
): Promise<void> {
  // ----- User 1: enrolled in the path -----
  await prisma.user.create({
    data: {
      id: FIXTURE.users.u1,
      name: 'المستخدم الأول',
      email: 'seed-user-1@awamer.test',
      passwordHash: PLACEHOLDER_PASSWORD_HASH,
      emailVerified: true,
      profile: {
        create: { displayName: 'User One', onboardingCompleted: true },
      },
      pathEnrollments: {
        create: {
          pathId: FIXTURE.path,
          status: EnrollmentStatus.ACTIVE,
        },
      },
    },
  });

  // Two lessons completed out of many
  const completedPathLessons = pathLessonIds.slice(0, 2);
  for (const lessonId of completedPathLessons) {
    await prisma.lessonProgress.create({
      data: {
        userId: FIXTURE.users.u1,
        lessonId,
        status: ProgressStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
  }

  // Section/course/path progress consistent with 2 completed lessons
  const firstLesson = await prisma.lesson.findUnique({
    where: { id: completedPathLessons[0] },
    include: { section: { include: { course: true } } },
  });
  if (firstLesson) {
    await prisma.sectionProgress.create({
      data: {
        userId: FIXTURE.users.u1,
        sectionId: firstLesson.sectionId,
        completedLessons: 2,
        totalLessons: 2,
        percentage: 100,
        status: ProgressStatus.COMPLETED,
      },
    });
    await prisma.courseProgress.create({
      data: {
        userId: FIXTURE.users.u1,
        courseId: firstLesson.section.courseId,
        completedSections: 1,
        totalSections: 2,
        percentage: 50,
        status: ProgressStatus.IN_PROGRESS,
      },
    });
    await prisma.pathProgress.create({
      data: {
        userId: FIXTURE.users.u1,
        pathId: FIXTURE.path,
        completedCourses: 0,
        totalCourses: 2,
        percentage: 25,
        status: ProgressStatus.IN_PROGRESS,
      },
    });
    await prisma.lastPosition.create({
      data: {
        userId: FIXTURE.users.u1,
        pathId: FIXTURE.path,
        courseId: null,
        sectionId: firstLesson.sectionId,
        lessonId: firstLesson.id,
      },
    });
  }

  // ----- User 2: enrolled in the standalone course with a COURSE certificate -----
  await prisma.user.create({
    data: {
      id: FIXTURE.users.u2,
      name: 'المستخدم الثاني',
      email: 'seed-user-2@awamer.test',
      passwordHash: PLACEHOLDER_PASSWORD_HASH,
      emailVerified: true,
      profile: {
        create: { displayName: 'User Two', onboardingCompleted: true },
      },
      courseEnrollments: {
        create: {
          courseId: FIXTURE.standaloneCourse,
          status: CourseEnrollmentStatus.ACTIVE,
        },
      },
    },
  });

  if (standaloneLessonIds.length > 0) {
    await prisma.lessonProgress.create({
      data: {
        userId: FIXTURE.users.u2,
        lessonId: standaloneLessonIds[0],
        status: ProgressStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    const firstStandaloneLesson = await prisma.lesson.findUnique({
      where: { id: standaloneLessonIds[0] },
    });
    if (firstStandaloneLesson) {
      await prisma.lastPosition.create({
        data: {
          userId: FIXTURE.users.u2,
          pathId: null,
          courseId: FIXTURE.standaloneCourse,
          sectionId: firstStandaloneLesson.sectionId,
          lessonId: firstStandaloneLesson.id,
        },
      });
    }
  }

  await prisma.certificate.create({
    data: {
      userId: FIXTURE.users.u2,
      courseId: FIXTURE.standaloneCourse,
      pathId: null,
      type: CertificateType.COURSE,
      certificateCode: `CERT-${FIXTURE.users.u2}-${FIXTURE.standaloneCourse}`,
      certificateUrl: 'https://example.com/cert.pdf',
    },
  });
}

async function main(): Promise<void> {
  console.log('Seeding Awamer v6 fixtures...');
  await cleanup();
  await seedCategories();
  await seedTags();
  await seedPlans();
  const { lessonIds } = await seedPathWithContent();
  const { standaloneLessonIds } = await seedStandaloneCourse();
  await seedUsers(lessonIds, standaloneLessonIds);
  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
