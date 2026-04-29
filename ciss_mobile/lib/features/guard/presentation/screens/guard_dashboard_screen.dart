import 'package:flutter/material.dart';

import '../../../../shared/widgets/screen_scaffold.dart';
import '../../../../shared/widgets/section_card.dart';

class GuardDashboardScreen extends StatelessWidget {
  const GuardDashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ScreenScaffold(
      title: 'Guard Dashboard',
      subtitle: 'Daily operations',
      children: <Widget>[
        SectionCard(
          title: 'Mark Attendance',
          subtitle:
              'Check in or check out with site, duty point, shift, photo, and GPS.',
          icon: Icons.qr_code_scanner_rounded,
        ),
        SectionCard(
          title: 'Today\'s Assignment',
          subtitle:
              'Duty point, shift, and client instructions show here once connected.',
          icon: Icons.badge_outlined,
        ),
        SectionCard(
          title: 'Quick Actions',
          subtitle:
              'Profile, payslips, leave, training, evaluations, and incident reporting.',
          icon: Icons.grid_view_rounded,
        ),
      ],
    );
  }
}

