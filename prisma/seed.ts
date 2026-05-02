/**
 * Awamer — Seed Script (v2.1 — unified, safe for existing subscriptions)
 *
 * يدمج هذا الملف:
 *   - هيكل seed السابق: fixtures IDs ثابتة، cleanup idempotent،
 *     users/progress/certificates/plans لاختبار كامل المنصّة.
 *   - محتوى عربي واقعي مطابق لتصميم Figma لصفحة الكورس:
 *     14 درساً، 4 مشاريع، ~407 دقيقة، مبتدئ، شهادة عند الإنتهاء.
 *
 * التغييرات في v2.1:
 *   - cleanup يحذف كل الكورسات/المسارات التابعة للـ fixture categories
 *     (وليس فقط ذات fixed IDs) — لمعالجة seed قديم بـ IDs مختلفة.
 *   - Subscription plans تُستخدم upsert بدل delete+create — لتجنّب كسر
 *     subscriptions موجودة لمستخدمين خارج الـ fixtures.
 *
 * التشغيل:
 *   npx prisma db seed
 *   npx prisma migrate reset     (لمسح كامل + seed)
 */

import {
  PrismaClient,
  CertificateType,
  CourseEnrollmentStatus,
  CourseLevel,
  CourseStatus,
  EnrollmentStatus,
  LessonType,
  MarketingOwnerType,
  PathStatus,
  ProgressStatus,
  TestimonialStatus,
  TagStatus,
  CategoryStatus,
  BillingCycle,
} from '@prisma/client';

const prisma = new PrismaClient();

// ============================================================================
// Fixture IDs — ثابتة لتمكّن cleanup idempotent ولتسهّل assertions
// ============================================================================

const FIXTURE = {
  categories: {
    ai: 'seed-cat-ai',
    software: 'seed-cat-software',
  },
  tags: {
    ai: 'seed-tag-ai',
    ml: 'seed-tag-ml',
    dataAnalysis: 'seed-tag-data-analysis',
    python: 'seed-tag-python',
    productDev: 'seed-tag-product-dev',
    productAnalytics: 'seed-tag-product-analytics',
    ux: 'seed-tag-ux',
    cybersecurity: 'seed-tag-cybersecurity',
    sql: 'seed-tag-sql',
    databases: 'seed-tag-databases',
    beginner: 'seed-tag-beginner',
  },
  plans: {
    free: 'seed-plan-free',
    monthly: 'seed-plan-monthly',
    quarterly: 'seed-plan-quarterly',
    yearly: 'seed-plan-yearly',
  },
  path: 'seed-path-ai-foundations',
  coursesInPath: {
    dataAnalysis: 'seed-course-data-analysis',
    deepLearning: 'seed-course-deep-learning',
  },
  standaloneCourse: 'seed-course-sql-beginners',
  users: {
    u1: 'seed-user-1',
    u2: 'seed-user-2',
  },
} as const;

const PLACEHOLDER_PASSWORD_HASH =
  '$2a$10$abcdefghijklmnopqrstuuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV';

// ============================================================================
// Cleanup — يمسح فقط البيانات التي ينشئها هذا السكريبت
// ============================================================================

async function cleanup(): Promise<void> {
  const ownerIds = [
    FIXTURE.path,
    FIXTURE.coursesInPath.dataAnalysis,
    FIXTURE.coursesInPath.deepLearning,
    FIXTURE.standaloneCourse,
  ];

  // المحتوى التسويقي polymorphic — بلا FK، يُمسح صراحةً
  await prisma.feature.deleteMany({ where: { ownerId: { in: ownerIds } } });
  await prisma.faq.deleteMany({ where: { ownerId: { in: ownerIds } } });
  await prisma.testimonial.deleteMany({ where: { ownerId: { in: ownerIds } } });

  // Users cascade إلى enrollments / progress / certificates / last positions
  await prisma.user.deleteMany({
    where: { id: { in: Object.values(FIXTURE.users) } },
  });

  const fixtureCategoryIds = Object.values(FIXTURE.categories);

  // احذف كل الكورسات التي تنتمي لأحد الـ fixture categories
  // (بما فيها أي كورسات قديمة من seed سابق بـ IDs مختلفة)
  // Cascade سيحذف sections, lessons, course_tags, enrollments, progress, certificates
  await prisma.course.deleteMany({
    where: { categoryId: { in: fixtureCategoryIds } },
  });

  // احذف كل المسارات التي تنتمي لأحد الـ fixture categories
  await prisma.path.deleteMany({
    where: { categoryId: { in: fixtureCategoryIds } },
  });

  await prisma.tag.deleteMany({
    where: { id: { in: Object.values(FIXTURE.tags) } },
  });

  await prisma.category.deleteMany({
    where: { id: fixtureCategoryIds[0] ? { in: fixtureCategoryIds } : undefined },
  });

  // ملاحظة: لا نحذف subscription plans هنا.
  // إذا وُجدت subscriptions خارج الـ fixtures تشير لخطة من خططنا،
  // فحذف الخطة يكسرها. نستخدم upsert في seedPlans بدلاً من ذلك.
}

// ============================================================================
// Categories
// ============================================================================

async function seedCategories(): Promise<void> {
  await prisma.category.createMany({
    data: [
      {
        id: FIXTURE.categories.ai,
        name: 'الذكاء الاصطناعي وعلم البيانات',
        slug: 'artificial-intelligence',
        order: 1,
        status: CategoryStatus.ACTIVE,
      },
      {
        id: FIXTURE.categories.software,
        name: 'تطوير البرمجيات',
        slug: 'software-development',
        order: 2,
        status: CategoryStatus.ACTIVE,
      },
    ],
  });
}

// ============================================================================
// Tags
// ============================================================================

async function seedTags(): Promise<void> {
  await prisma.tag.createMany({
    data: [
      { id: FIXTURE.tags.ai, name: 'ذكاء صناعي', slug: 'ai', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.ml, name: 'تعلم آلي', slug: 'ml', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.dataAnalysis, name: 'تحليل بيانات', slug: 'data-analysis', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.python, name: 'بايثون', slug: 'python', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.productDev, name: 'تطوير منتجات', slug: 'product-dev', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.productAnalytics, name: 'تحليلات المنتج', slug: 'product-analytics', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.ux, name: 'تجربة مستخدم', slug: 'ux', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.cybersecurity, name: 'أمن سيبراني', slug: 'cybersecurity', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.sql, name: 'SQL', slug: 'sql', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.databases, name: 'قواعد بيانات', slug: 'databases', status: TagStatus.ACTIVE },
      { id: FIXTURE.tags.beginner, name: 'مناسب للمبتدئين', slug: 'beginner-friendly', status: TagStatus.ACTIVE },
    ],
  });
}

// ============================================================================
// Subscription Plans — upsert (لا نحذف، لحماية subscriptions الموجودة)
// ============================================================================

async function seedPlans(): Promise<void> {
  const plans = [
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
      isDefault: false,
    },
    {
      id: FIXTURE.plans.quarterly,
      name: 'Quarterly',
      billingCycle: BillingCycle.QUARTERLY,
      price: 49,
      durationDays: 90,
      isDefault: false,
    },
    {
      id: FIXTURE.plans.yearly,
      name: 'Yearly',
      billingCycle: BillingCycle.YEARLY,
      price: 159,
      durationDays: 365,
      isDefault: false,
    },
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { id: plan.id },
      update: {
        name: plan.name,
        billingCycle: plan.billingCycle,
        price: plan.price,
        durationDays: plan.durationDays,
        isDefault: plan.isDefault,
      },
      create: plan,
    });
  }
}

// ============================================================================
// Path — "أساسيات الذكاء الاصطناعي وعلم البيانات"
// ============================================================================

async function seedPath(): Promise<void> {
  await prisma.path.create({
    data: {
      id: FIXTURE.path,
      categoryId: FIXTURE.categories.ai,
      slug: 'ai-data-foundations',
      title: 'أساسيات الذكاء الاصطناعي وعلم البيانات',
      subtitle: 'رحلة تعلّم مُنظّمة من تحليل البيانات الأساسي إلى بناء أول نموذج تعلّم آلي.',
      description:
        'مسار متكامل مصمّم للمبتدئين الذين يرغبون في دخول مجال الذكاء الاصطناعي وعلم البيانات بشكل جدّي. يبدأ من المفاهيم الأولية لتحليل البيانات، يمرّ بأساسيات SQL والإحصاء، وينتهي ببناء نماذج تعلّم آلي بسيطة وتقييمها. يركّز المسار على الممارسة والمشاريع الحقيقية أكثر من النظرية.',
      featuresIntro: 'كل ما تحتاجه لتنتقل من المبتدئ المطلق إلى مستوى يؤهّلك لدخول سوق العمل — خطة واضحة، مشاريع عملية، ومجتمع يساندك.',
      level: 'beginner',
      thumbnail: 'https://placehold.co/600x400?text=AI+Path',
      promoVideoUrl: 'https://youtu.be/UwY8wO746uo',
      promoVideoThumbnail: 'https://placehold.co/600x400?text=promo',
      estimatedHours: 25,
      isNew: true,
      skills: [
        'تحليل البيانات باستخدام Python',
        'كتابة استعلامات SQL متقدّمة',
        'تطبيق أساسيات الإحصاء الوصفي',
        'بناء نماذج تعلّم آلي بسيطة',
        'تقييم أداء النماذج',
      ],
      isFree: false,
      status: PathStatus.PUBLISHED,
      order: 1,
      tags: {
        create: [
          { tagId: FIXTURE.tags.ai },
          { tagId: FIXTURE.tags.ml },
          { tagId: FIXTURE.tags.dataAnalysis },
          { tagId: FIXTURE.tags.python },
        ],
      },
    },
  });

  await prisma.feature.createMany({
    data: [
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, icon: 'Target01', title: 'مسار مُنظّم بخطوات واضحة', description: 'لا تتوه بين عشرات المصادر — خطة تعلّم واحدة متكاملة من البداية إلى النهاية.', order: 1 },
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, icon: 'Code02', title: 'مشاريع عملية بين كل دورة', description: 'تطبّق ما تتعلّمه فوراً على بيانات حقيقية، لا أمثلة تخيّلية.', order: 2 },
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, icon: 'Users01', title: 'مجتمع دعم عربي', description: 'تواصل مع متعلّمين آخرين في نفس الرحلة واسأل حين تحتاج.', order: 3 },
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, icon: 'Certificate01', title: 'شهادة مسار + شهادات دورات', description: 'تحصل على شهادة لكل دورة تنهيها، وشهادة مسار شاملة عند إتمام المسار كاملاً.', order: 4 },
    ],
  });

  await prisma.faq.createMany({
    data: [
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, question: 'كم من الوقت يستغرق المسار كاملاً؟', answer: 'المتعلّم المتفرّغ ينهيه خلال ٢-٣ أشهر. لو كنت بدوام كامل، احسب ٤-٦ أشهر.', order: 1 },
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, question: 'هل أحتاج خلفية برمجية سابقة؟', answer: 'لا. المسار يبدأ من الصفر ويشرح Python وكل الأدوات اللازمة.', order: 2 },
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, question: 'ما الفرق بين دورات المسار والدورات المستقلّة؟', answer: 'دورات المسار مُرتَّبة بتسلسل يبني بعضها على بعض ومناسبة لمن يريد تعلّماً منهجياً. الدورات المستقلّة قصيرة ومركّزة على مهارة واحدة.', order: 3 },
    ],
  });

  await prisma.testimonial.createMany({
    data: [
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, authorName: 'سارة المطيري', authorTitle: 'خرّيجة المسار — محلّلة بيانات', content: 'غيّر المسار مساري المهني فعلياً. انتقلت من التسويق إلى تحليل البيانات خلال ٦ أشهر.', rating: 5, status: TestimonialStatus.APPROVED, order: 1 },
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, authorName: 'عبدالله الشمري', authorTitle: 'مهندس برمجيات', content: 'بانتظار المراجعة من الفريق.', rating: 4, status: TestimonialStatus.PENDING, order: 2 },
      { ownerType: MarketingOwnerType.PATH, ownerId: FIXTURE.path, authorName: 'حذف تجريبي', authorTitle: 'محلل', content: 'هذه شهادة مُخفاة يجب ألّا تظهر في العرض العام.', rating: 3, status: TestimonialStatus.HIDDEN, order: 3 },
    ],
  });
}

// ============================================================================
// Course 1 (in path) — "مقدمة إلى تحليل البيانات"
// مطابق لتصميم Figma: 14 درساً، 4 مشاريع، 407 دقيقة
// ============================================================================

async function seedCourseDataAnalysis(): Promise<void> {
  await prisma.course.create({
    data: {
      id: FIXTURE.coursesInPath.dataAnalysis,
      categoryId: FIXTURE.categories.ai,
      pathId: FIXTURE.path,
      slug: 'intro-to-data-analysis',
      title: 'مقدمة إلى تحليل البيانات',
      subtitle: 'تحليلات منتج ونمو قوية وسهلة الاستخدام تساعدك على تحويل المستخدمين، وإشراكهم، والاحتفاظ بالمزيد منهم.',
      description: 'في هذه الدورة ستتعلّم كيف تتعامل مع البيانات من الصفر: من استيرادها وتنظيفها، إلى استكشافها وفهم أنماطها، وصولاً إلى استخراج رؤى عملية منها. الدورة مبنية حول أمثلة تطبيقية من بيئات حقيقية — تحليلات منتج، سلوك مستخدمين، وقياس أداء حملات تسويقية. لا تحتاج خبرة سابقة في البرمجة، فقط رغبة حقيقية في التعلّم وفضول لطرح الأسئلة الصحيحة على بياناتك.',
      featuresIntro: 'كل ما تحتاجه لتبدأ رحلتك في تحليل البيانات بثقة — محتوى عملي، تمارين بعد كل درس، وشهادة معتمدة في النهاية.',
      level: CourseLevel.BEGINNER,
      thumbnail: 'https://placehold.co/600x400?text=Data+Analysis',
      isNew: true,
      skills: [
        'استيراد البيانات وتنظيفها باستخدام Pandas',
        'إجراء تحليل استكشافي (EDA) للبيانات',
        'بناء رسومات بيانية واضحة باستخدام Matplotlib و Seaborn',
        'طرح أسئلة تحليلية على البيانات والإجابة عليها',
      ],
      order: 1,
      isFree: false,
      status: CourseStatus.PUBLISHED,
      tags: {
        create: [
          { tagId: FIXTURE.tags.dataAnalysis },
          { tagId: FIXTURE.tags.python },
          { tagId: FIXTURE.tags.productAnalytics },
          { tagId: FIXTURE.tags.beginner },
        ],
      },
      sections: {
        create: [
          {
            title: 'القسم ١: مدخل إلى عالم البيانات',
            description: 'شرح بسيط عن ماهية تحليل البيانات، الأدوات الأساسية، وكيف تبدأ رحلتك بشكل صحيح.',
            order: 1,
            lessons: {
              create: [
                { title: 'ما هو تحليل البيانات ولماذا نحتاجه؟', type: LessonType.VIDEO, order: 1, isFree: true, estimatedMinutes: 12 },
                { title: 'الفرق بين محلل البيانات وعالم البيانات', type: LessonType.TEXT, order: 2, isFree: true, estimatedMinutes: 8 },
                { title: 'تجهيز بيئة العمل: Python و Jupyter', type: LessonType.VIDEO, order: 3, isFree: false, estimatedMinutes: 15 },
                { title: 'تقييم سريع للقسم الأول', type: LessonType.INTERACTIVE, order: 4, isFree: false, estimatedMinutes: 10 },
              ],
            },
          },
          {
            title: 'القسم ٢: التعامل مع البيانات باستخدام Pandas',
            description: 'مكتبة Pandas هي الأداة الأساسية لكل محلل بيانات. سنتعلّم كيف نقرأ، نستكشف، وننظّف البيانات.',
            order: 2,
            lessons: {
              create: [
                { title: 'قراءة ملفات CSV و Excel', type: LessonType.VIDEO, order: 1, isFree: false, estimatedMinutes: 20 },
                { title: 'استكشاف البيانات: head, info, describe', type: LessonType.VIDEO, order: 2, isFree: false, estimatedMinutes: 18 },
                { title: 'التعامل مع القيم المفقودة', type: LessonType.TEXT, order: 3, isFree: false, estimatedMinutes: 22 },
                { title: 'مشروع: تنظيف بيانات مبيعات متجر', type: LessonType.INTERACTIVE, order: 4, isFree: false, estimatedMinutes: 45 },
              ],
            },
          },
          {
            title: 'القسم ٣: التحليل الاستكشافي والرسومات',
            description: 'كيف تحوّل أعمدة من الأرقام إلى قصّة واضحة باستخدام الرسوم البيانية.',
            order: 3,
            lessons: {
              create: [
                { title: 'مبادئ التصور الجيد للبيانات', type: LessonType.VIDEO, order: 1, isFree: false, estimatedMinutes: 18 },
                { title: 'Matplotlib: الأساسيات', type: LessonType.VIDEO, order: 2, isFree: false, estimatedMinutes: 25 },
                { title: 'Seaborn: رسومات أجمل بأسطر أقل', type: LessonType.VIDEO, order: 3, isFree: false, estimatedMinutes: 22 },
                { title: 'مشروع: لوحة قيادة لتحليلات منتج', type: LessonType.INTERACTIVE, order: 4, isFree: false, estimatedMinutes: 60 },
              ],
            },
          },
          {
            title: 'القسم ٤: المشاريع التطبيقية الختامية',
            description: 'تجميع كل ما تعلّمته في مشروعين حقيقيين من البداية إلى النهاية.',
            order: 4,
            lessons: {
              create: [
                { title: 'مشروع: تحليل سلوك مستخدمي تطبيق', type: LessonType.INTERACTIVE, order: 1, isFree: false, estimatedMinutes: 70 },
                { title: 'مشروع: قياس أداء حملة تسويقية', type: LessonType.INTERACTIVE, order: 2, isFree: false, estimatedMinutes: 62 },
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.feature.createMany({
    data: [
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.dataAnalysis, icon: 'BookOpen01', title: 'محتوى عملي بالكامل', description: 'كل قسم مبني حول أمثلة تطبيقية من بيئات حقيقية، لا نظرية مجرّدة.', order: 1 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.dataAnalysis, icon: 'Code02', title: 'تمارين بعد كل درس', description: 'تثبّت ما تعلّمته فور انتهاء كل درس عبر تمارين تفاعلية مصمّمة بعناية.', order: 2 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.dataAnalysis, icon: 'Users01', title: 'مبني لمستوى المبتدئين', description: 'لا يفترض خبرة سابقة في البرمجة أو الإحصاء — نبدأ معك من الصفر.', order: 3 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.dataAnalysis, icon: 'Certificate01', title: 'شهادة معتمدة عند الإنتهاء', description: 'احصل على شهادة Awamer يمكنك مشاركتها على ملفك المهني بعد إتمام جميع المهام.', order: 4 },
    ],
  });

  await prisma.faq.createMany({
    data: [
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.dataAnalysis, question: 'هل أحتاج خبرة سابقة في البرمجة؟', answer: 'لا. الدورة مصمّمة للمبتدئين تماماً ونبدأ من تثبيت Python وشرح أساسيات الكود.', order: 1 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.dataAnalysis, question: 'كم من الوقت أحتاج لإنهاء الدورة؟', answer: 'مدّة الدورة الصافية ٦ ساعات و٤٥ دقيقة، لكن مع التمارين والمشاريع تحتاج حوالي ٢٠-٢٥ ساعة على مدى ٣-٤ أسابيع.', order: 2 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.dataAnalysis, question: 'هل المشاريع إلزامية للحصول على الشهادة؟', answer: 'نعم. الشهادة تُمنح بعد إتمام جميع الدروس وتسليم المشاريع الأربعة بنجاح.', order: 3 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.dataAnalysis, question: 'ما الفرق بين هذه الدورة والدورة المستقلة "أساسيات SQL"؟', answer: 'هذه الدورة تركّز على Python و Pandas وتحليل البيانات بشكل عام، بينما دورة SQL متخصّصة في قواعد البيانات. كلتاهما تكمّل الأخرى.', order: 4 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.dataAnalysis, question: 'هل يمكنني متابعة الدورة على الجوّال؟', answer: 'نعم يمكنك المشاهدة من أي جهاز، لكن التمارين العملية تتطلّب حاسوباً لتشغيل Python.', order: 5 },
    ],
  });

  await prisma.testimonial.createMany({
    data: [
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.dataAnalysis, authorName: 'نورة الحربي', authorTitle: 'محلّلة بيانات في شركة ناشئة', content: 'أفضل دورة عربية دخلت فيها في هذا المجال. أسلوب الشرح واضح والمشاريع واقعية جداً. انتقلت من عدم معرفتي بـ Pandas إلى استخدامها يومياً في عملي.', rating: 5, status: TestimonialStatus.APPROVED, order: 1 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.dataAnalysis, authorName: 'يوسف الراشد', authorTitle: 'طالب هندسة برمجيات', content: 'بدأت الدورة بدون أي خلفية برمجية وأنهيتها خلال شهر. المشاريع الختامية كانت التحدي الحقيقي الذي جعلني أفهم كل شيء بعمق.', rating: 5, status: TestimonialStatus.APPROVED, order: 2 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.dataAnalysis, authorName: 'ريم العتيبي', authorTitle: 'مسوّقة رقمية', content: 'كنت أبحث عن دورة تساعدني أفهم بيانات حملاتي بدل الاعتماد على فرق أخرى. هذه الدورة أعطتني الاستقلالية التي احتاجها.', rating: 4, status: TestimonialStatus.APPROVED, order: 3 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.dataAnalysis, authorName: 'محمد القحطاني', authorTitle: 'مهندس بيانات', content: 'مراجعة بانتظار الاعتماد من الإدارة.', rating: 5, status: TestimonialStatus.PENDING, order: 4 },
    ],
  });

  await prisma.project.create({
    data: {
      courseId: FIXTURE.coursesInPath.dataAnalysis,
      title: 'مشروع نهاية الدورة: تحليل كامل لبيانات متجر',
      description: 'مشروع تطبيقي شامل تأخذ فيه بيانات متجر إلكتروني حقيقية وتنتج منها تقرير تحليلي كامل مع رسومات.',
      order: 1,
    },
  });
}

// ============================================================================
// Course 2 (in path) — "مقدمة في التعلم العميق"
// ============================================================================

async function seedCourseDeepLearning(): Promise<void> {
  await prisma.course.create({
    data: {
      id: FIXTURE.coursesInPath.deepLearning,
      categoryId: FIXTURE.categories.ai,
      pathId: FIXTURE.path,
      slug: 'deep-learning-intro',
      title: 'مقدمة في التعلم العميق',
      subtitle: 'من الشبكات العصبية البسيطة إلى نماذج ترتيب وصورة حقيقية.',
      description: 'دورة تكميلية ضمن مسار الذكاء الاصطناعي تبني على ما تعلّمته في تحليل البيانات لتنتقل إلى الشبكات العصبية. ستفهم كيف تعمل الطبقات، كيف تُدرَّب النماذج، وكيف تبني أول شبكة عصبية بـ PyTorch.',
      featuresIntro: 'دورة تجمع بين الأساس النظري والتطبيق المباشر — كل مفهوم مصحوب بمشروع PyTorch تبنيه بنفسك.',
      level: CourseLevel.INTERMEDIATE,
      thumbnail: 'https://placehold.co/600x400?text=Deep+Learning',
      isNew: false,
      skills: ['فهم الشبكات العصبية الأمامية', 'استخدام PyTorch لبناء نماذج بسيطة', 'تدريب النماذج وتقييمها'],
      order: 2,
      isFree: false,
      status: CourseStatus.PUBLISHED,
      tags: {
        create: [{ tagId: FIXTURE.tags.ai }, { tagId: FIXTURE.tags.ml }, { tagId: FIXTURE.tags.python }],
      },
      sections: {
        create: [
          {
            title: 'القسم ١: الشبكات العصبية من الصفر',
            description: 'ما هي الشبكة العصبية وكيف تتعلم.',
            order: 1,
            lessons: {
              create: [
                { title: 'الخلية العصبية الاصطناعية', type: LessonType.VIDEO, order: 1, isFree: true, estimatedMinutes: 15 },
                { title: 'الطبقات والتفعيلات', type: LessonType.VIDEO, order: 2, isFree: false, estimatedMinutes: 18 },
                { title: 'مشروع: شبكة بسيطة بيديك', type: LessonType.INTERACTIVE, order: 3, isFree: false, estimatedMinutes: 45 },
              ],
            },
          },
          {
            title: 'القسم ٢: التدريب والتقييم',
            description: 'كيف يتعلّم النموذج من الأخطاء.',
            order: 2,
            lessons: {
              create: [
                { title: 'Loss functions و Backpropagation', type: LessonType.VIDEO, order: 1, isFree: false, estimatedMinutes: 25 },
                { title: 'تقييم النموذج ومقاييس الأداء', type: LessonType.TEXT, order: 2, isFree: false, estimatedMinutes: 15 },
                { title: 'مشروع: تدريب نموذج تصنيف صور', type: LessonType.INTERACTIVE, order: 3, isFree: false, estimatedMinutes: 50 },
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.feature.createMany({
    data: [
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.deepLearning, icon: 'Cpu', title: 'من النظرية إلى التطبيق', description: 'كل مفهوم نظري مصحوب بتطبيق مباشر في PyTorch.', order: 1 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.deepLearning, icon: 'LayersTwo01', title: 'بناء نماذج حقيقية', description: 'مشاريع تصنيف صور وتحليل نصوص بسيطة بحلول انتهاء الدورة.', order: 2 },
    ],
  });

  await prisma.faq.createMany({
    data: [
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.deepLearning, question: 'هل أحتاج إكمال دورة تحليل البيانات أولاً؟', answer: 'يُفضَّل ذلك، لكن إذا كنت مرتاحاً مع Python و NumPy يمكنك البدء مباشرة.', order: 1 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.coursesInPath.deepLearning, question: 'هل أحتاج GPU؟', answer: 'لا لهذه الدورة — المشاريع مصمّمة لتعمل على CPU عادي.', order: 2 },
    ],
  });
}

// ============================================================================
// Standalone Course — "أساسيات SQL للمبتدئين"
// ============================================================================

async function seedStandaloneCourse(): Promise<void> {
  await prisma.course.create({
    data: {
      id: FIXTURE.standaloneCourse,
      categoryId: FIXTURE.categories.software,
      pathId: null,
      order: null,
      slug: 'sql-for-beginners',
      title: 'أساسيات SQL للمبتدئين',
      subtitle: 'تعلّم لغة قواعد البيانات الأكثر طلباً في سوق العمل — من الصفر حتى الاستعلامات المتقدّمة.',
      description: 'دورة قصيرة ومركّزة لتعلّم SQL من الصفر. ستبدأ بالاستعلامات الأساسية، تتعلّم كيف تربط الجداول، وتنتهي بكتابة استعلامات معقّدة تحلّل من خلالها بيانات حقيقية. الدورة مناسبة لكل من يريد دخول مجال البيانات أو تطوير البرمجيات، ولا تحتاج أي خلفية سابقة. كل درس مصحوب بتمارين عملية على قاعدة بيانات جاهزة.',
      featuresIntro: 'دورة مجانية وقصيرة وعملية بالكامل — تخرج منها قادراً على كتابة استعلامات حقيقية في عملك.',
      level: CourseLevel.BEGINNER,
      thumbnail: 'https://placehold.co/600x400?text=SQL',
      isNew: false,
      skills: [
        'كتابة استعلامات SELECT الأساسية',
        'تصفية وترتيب النتائج',
        'ربط الجداول باستخدام JOIN',
        'استخدام دوال التجميع GROUP BY',
      ],
      isFree: true,
      status: CourseStatus.PUBLISHED,
      tags: {
        create: [
          { tagId: FIXTURE.tags.sql },
          { tagId: FIXTURE.tags.databases },
          { tagId: FIXTURE.tags.beginner },
        ],
      },
      sections: {
        create: [
          {
            title: 'القسم ١: مدخل إلى قواعد البيانات',
            description: 'ما هي قاعدة البيانات، ولماذا نحتاج لغة خاصة للتحدّث إليها؟',
            order: 1,
            lessons: {
              create: [
                { title: 'ما هي قاعدة البيانات العلائقية؟', type: LessonType.VIDEO, order: 1, isFree: true, estimatedMinutes: 10 },
                { title: 'تثبيت PostgreSQL محلياً', type: LessonType.VIDEO, order: 2, isFree: true, estimatedMinutes: 12 },
              ],
            },
          },
          {
            title: 'القسم ٢: الاستعلامات الأساسية',
            description: 'SELECT، WHERE، ORDER BY — الأدوات التي ستستخدمها يومياً.',
            order: 2,
            lessons: {
              create: [
                { title: 'SELECT وجلب البيانات', type: LessonType.VIDEO, order: 1, isFree: true, estimatedMinutes: 15 },
                { title: 'WHERE وتصفية النتائج', type: LessonType.VIDEO, order: 2, isFree: true, estimatedMinutes: 18 },
                { title: 'مشروع: تحليل جدول موظفين', type: LessonType.INTERACTIVE, order: 3, isFree: true, estimatedMinutes: 40 },
              ],
            },
          },
          {
            title: 'القسم ٣: الاستعلامات المتقدّمة',
            description: 'JOIN و GROUP BY — حيث تصبح SQL أداة تحليل حقيقية.',
            order: 3,
            lessons: {
              create: [
                { title: 'ربط الجداول: INNER JOIN و LEFT JOIN', type: LessonType.VIDEO, order: 1, isFree: true, estimatedMinutes: 25 },
                { title: 'التجميع والإحصاءات: GROUP BY', type: LessonType.VIDEO, order: 2, isFree: true, estimatedMinutes: 20 },
                { title: 'مشروع: استعلامات تحليلية على متجر إلكتروني', type: LessonType.INTERACTIVE, order: 3, isFree: true, estimatedMinutes: 45 },
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.feature.createMany({
    data: [
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, icon: 'Zap', title: 'قصيرة ومركّزة', description: 'تنتهي منها خلال أسبوع وتتقن مهارة مطلوبة في سوق العمل.', order: 1 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, icon: 'Database01', title: 'قاعدة بيانات جاهزة للتدريب', description: 'نوفّر لك قاعدة بيانات حقيقية مع بيانات واقعية لتتدرّب عليها.', order: 2 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, icon: 'BookOpen01', title: 'شرح عربي واضح', description: 'لا ترجمة حرفية — الشرح مبني أصلاً بالعربية مع الحفاظ على المصطلحات التقنية.', order: 3 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, icon: 'Gift01', title: 'مجانية بالكامل', description: 'كل الدورة متاحة مجاناً — نريدها نقطة انطلاق لكل من يرغب في دخول المجال.', order: 4 },
    ],
  });

  await prisma.faq.createMany({
    data: [
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, question: 'هل الدورة مجانية فعلاً؟', answer: 'نعم، كل الدورة بما فيها المشاريع مجانية ولا تحتاج اشتراك Awamer Plus.', order: 1 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, question: 'هل تكفي هذه الدورة للعمل كمحلّل بيانات؟', answer: 'هي خطوة أولى ممتازة لكن ليست كافية وحدها. ننصح بإكمالها بدورة "مقدمة إلى تحليل البيانات" أو مسار الذكاء الاصطناعي.', order: 2 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, question: 'أي نكهة SQL نستخدم في الدورة؟', answer: 'نستخدم PostgreSQL، لكن المفاهيم الأساسية تنطبق على MySQL و SQL Server وغيرهما.', order: 3 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, question: 'هل يوجد شهادة عند الإنتهاء؟', answer: 'نعم، شهادة إتمام دورة عند إكمال جميع الدروس والمشروعين.', order: 4 },
    ],
  });

  await prisma.testimonial.createMany({
    data: [
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, authorName: 'أحمد الدوسري', authorTitle: 'مطوّر backend مبتدئ', content: 'بسيطة وفي الصميم. تعلّمت ما أحتاجه في أسبوع وأصبحت أكتب استعلامات تحليلية في عملي بثقة.', rating: 5, status: TestimonialStatus.APPROVED, order: 1 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, authorName: 'لينا الشمري', authorTitle: 'طالبة علوم حاسب', content: 'أفضل شيء أن الدورة قصيرة ومجانية ومع ذلك محتواها قوي. المشاريع العملية كانت الأفضل.', rating: 5, status: TestimonialStatus.APPROVED, order: 2 },
      { ownerType: MarketingOwnerType.COURSE, ownerId: FIXTURE.standaloneCourse, authorName: 'خالد العنزي', authorTitle: 'مدير منتج', content: 'كمدير منتج احتجت أفهم SQL لأستعلم بنفسي بدل الانتظار على فريق البيانات. هذه الدورة فعلت ذلك.', rating: 4, status: TestimonialStatus.APPROVED, order: 3 },
    ],
  });

  await prisma.project.create({
    data: {
      courseId: FIXTURE.standaloneCourse,
      title: 'مشروع: لوحة تحليلية لقاعدة بيانات مبيعات',
      description: 'كتابة مجموعة استعلامات SQL تجيب على أسئلة عمل حقيقية من قاعدة بيانات مبيعات.',
      order: 1,
    },
  });
}

// ============================================================================
// Users + Enrollments + Progress + Certificates
// ============================================================================

async function seedUsersWithProgress(): Promise<void> {
  // User 1: مسجّل في المسار، أتمّ درسين من الدورة الأولى
  await prisma.user.create({
    data: {
      id: FIXTURE.users.u1,
      name: 'المستخدم الأول',
      email: 'seed-user-1@awamer.test',
      passwordHash: PLACEHOLDER_PASSWORD_HASH,
      emailVerified: true,
      profile: { create: { displayName: 'User One', onboardingCompleted: true } },
      pathEnrollments: {
        create: { pathId: FIXTURE.path, status: EnrollmentStatus.ACTIVE },
      },
    },
  });

  const dataAnalysisLessons = await prisma.lesson.findMany({
    where: { section: { courseId: FIXTURE.coursesInPath.dataAnalysis } },
    orderBy: [{ section: { order: 'asc' } }, { order: 'asc' }],
    include: { section: true },
  });

  const completedLessons = dataAnalysisLessons.slice(0, 2);
  for (const lesson of completedLessons) {
    await prisma.lessonProgress.create({
      data: {
        userId: FIXTURE.users.u1,
        lessonId: lesson.id,
        status: ProgressStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
  }

  const firstSection = completedLessons[0].section;
  const sectionLessonsCount = await prisma.lesson.count({ where: { sectionId: firstSection.id } });
  await prisma.sectionProgress.create({
    data: {
      userId: FIXTURE.users.u1,
      sectionId: firstSection.id,
      completedLessons: 2,
      totalLessons: sectionLessonsCount,
      percentage: Math.round((2 / sectionLessonsCount) * 100),
      status: ProgressStatus.IN_PROGRESS,
    },
  });

  const totalSections = await prisma.section.count({ where: { courseId: FIXTURE.coursesInPath.dataAnalysis } });
  await prisma.courseProgress.create({
    data: {
      userId: FIXTURE.users.u1,
      courseId: FIXTURE.coursesInPath.dataAnalysis,
      completedSections: 0,
      totalSections,
      percentage: 10,
      status: ProgressStatus.IN_PROGRESS,
    },
  });

  await prisma.pathProgress.create({
    data: {
      userId: FIXTURE.users.u1,
      pathId: FIXTURE.path,
      completedCourses: 0,
      totalCourses: 2,
      percentage: 5,
      status: ProgressStatus.IN_PROGRESS,
    },
  });

  await prisma.lastPosition.create({
    data: {
      userId: FIXTURE.users.u1,
      pathId: FIXTURE.path,
      courseId: null,
      sectionId: firstSection.id,
      lessonId: completedLessons[completedLessons.length - 1].id,
    },
  });

  // User 2: مسجّل في الكورس المستقلّ، حاصل على شهادة
  await prisma.user.create({
    data: {
      id: FIXTURE.users.u2,
      name: 'المستخدم الثاني',
      email: 'seed-user-2@awamer.test',
      passwordHash: PLACEHOLDER_PASSWORD_HASH,
      emailVerified: true,
      profile: { create: { displayName: 'User Two', onboardingCompleted: true } },
      courseEnrollments: {
        create: { courseId: FIXTURE.standaloneCourse, status: CourseEnrollmentStatus.ACTIVE },
      },
    },
  });

  const sqlLessons = await prisma.lesson.findMany({
    where: { section: { courseId: FIXTURE.standaloneCourse } },
    orderBy: [{ section: { order: 'asc' } }, { order: 'asc' }],
  });

  if (sqlLessons.length > 0) {
    const firstSqlLesson = sqlLessons[0];
    await prisma.lessonProgress.create({
      data: {
        userId: FIXTURE.users.u2,
        lessonId: firstSqlLesson.id,
        status: ProgressStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    await prisma.lastPosition.create({
      data: {
        userId: FIXTURE.users.u2,
        pathId: null,
        courseId: FIXTURE.standaloneCourse,
        sectionId: firstSqlLesson.sectionId,
        lessonId: firstSqlLesson.id,
      },
    });
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

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('🌱 Seeding Awamer fixtures (v2.1 — unified)...');
  await cleanup();
  console.log('  ✓ cleanup');
  await seedCategories();
  console.log('  ✓ categories');
  await seedTags();
  console.log('  ✓ tags');
  await seedPlans();
  console.log('  ✓ plans (upsert — existing subscriptions preserved)');
  await seedPath();
  console.log('  ✓ path (+ marketing)');
  await seedCourseDataAnalysis();
  console.log('  ✓ course 1 — intro-to-data-analysis (14 lessons / 4 projects / ~407 min)');
  await seedCourseDeepLearning();
  console.log('  ✓ course 2 — deep-learning-intro');
  await seedStandaloneCourse();
  console.log('  ✓ standalone course — sql-for-beginners (free)');
  await seedUsersWithProgress();
  console.log('  ✓ users + enrollments + progress + certificate');
  console.log('');
  console.log('✅ Seed complete.');
  console.log('');
  console.log('Test URLs:');
  console.log('  GET /api/v1/courses/intro-to-data-analysis   → كورس ضمن مسار، isNew، يتطلّب Plus');
  console.log('  GET /api/v1/courses/deep-learning-intro      → كورس ضمن مسار، متوسّط');
  console.log('  GET /api/v1/courses/sql-for-beginners        → كورس standalone، مجاني');
  console.log('  GET /api/v1/paths/ai-data-foundations        → المسار الأب');
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
