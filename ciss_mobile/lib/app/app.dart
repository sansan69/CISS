import 'package:flutter/material.dart';

import 'router/app_router.dart';
import 'theme/app_theme.dart';

class CissMobileApp extends StatelessWidget {
  const CissMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'CISS Workforce',
      debugShowCheckedModeBanner: false,
      theme: buildCissTheme(),
      routerConfig: appRouter,
    );
  }
}

