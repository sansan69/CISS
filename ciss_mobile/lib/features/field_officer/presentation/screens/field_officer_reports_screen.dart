import 'package:flutter/material.dart';

import '../../../../shared/widgets/screen_scaffold.dart';
import '../../../../shared/widgets/section_card.dart';

class FieldOfficerReportsScreen extends StatelessWidget {
  const FieldOfficerReportsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ScreenScaffold(
      title: 'Reports',
      subtitle: 'Visit and training submissions',
      children: <Widget>[
        SectionCard(
          title: 'New Visit Report',
          subtitle:
              'Client, site, visit summary, issues found, and actions required.',
          icon: Icons.article_outlined,
        ),
        SectionCard(
          title: 'New Training Report',
          subtitle:
              'Topic, attendance, duration, photos, and status.',
          icon: Icons.cast_for_education_outlined,
        ),
        SectionCard(
          title: 'Report History',
          subtitle: 'Review submitted visit and training reports.',
          icon: Icons.history_edu_outlined,
        ),
      ],
    );
  }
}
