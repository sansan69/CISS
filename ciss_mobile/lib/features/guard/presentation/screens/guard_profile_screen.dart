import 'package:flutter/material.dart';

import '../../../../shared/widgets/screen_scaffold.dart';
import '../../../../shared/widgets/section_card.dart';

class GuardProfileScreen extends StatelessWidget {
  const GuardProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ScreenScaffold(
      title: 'Profile',
      subtitle: 'Guard employment profile',
      children: <Widget>[
        SectionCard(
          title: 'Employee Details',
          subtitle:
              'Personal info, employee ID, client, district, and documents.',
          icon: Icons.person_outline_rounded,
        ),
      ],
    );
  }
}

