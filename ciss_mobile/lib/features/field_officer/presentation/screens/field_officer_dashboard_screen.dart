import 'package:flutter/material.dart';

import '../../../../shared/widgets/screen_scaffold.dart';
import '../../../../shared/widgets/section_card.dart';

class FieldOfficerDashboardScreen extends StatelessWidget {
  const FieldOfficerDashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ScreenScaffold(
      title: 'Field Officer Dashboard',
      subtitle: 'District operations',
      children: <Widget>[
        SectionCard(
          title: 'Upcoming Duties',
          subtitle: 'TCS work orders and assigned center coverage.',
          icon: Icons.assignment_turned_in_outlined,
        ),
        SectionCard(
          title: 'Visit Reporting',
          subtitle:
              'Submit site visit reports with guard count and field notes.',
          icon: Icons.fact_check_outlined,
        ),
        SectionCard(
          title: 'Training Reporting',
          subtitle: 'Record site-level training and attendance.',
          icon: Icons.school_outlined,
        ),
      ],
    );
  }
}

